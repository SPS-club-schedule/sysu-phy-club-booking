import { createHash } from 'node:crypto';
import { bookingEnd, overlaps, today, type Booking } from '../app/schedule';
import { spsBookings, type SpsSnapshot } from '../app/sps-integration';
import type { AccountEnv, AccountUser } from './accounts';
import type { BookingChange } from '../app/booking-handler';

const clean = (text: string) => text.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

function describe(booking: Booking) {
  return `${booking.club}「${clean(booking.activity)}」\n${booking.date} ${booking.start}–${booking.end}（北京时间），${clean(booking.location) || '地点未填写'}`;
}

export class BookingNotifications {
  constructor(private sql: SqlStorage, private env: AccountEnv) {
    sql.exec(`CREATE TABLE IF NOT EXISTS booking_club_contacts (club TEXT PRIMARY KEY, email TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS booking_creators (booking_id TEXT PRIMARY KEY, account_id TEXT NOT NULL)`);
  }

  contact(club: string) {
    return this.sql.exec<{email: string}>('SELECT email FROM booking_club_contacts WHERE club=?', club).toArray()[0]?.email ?? null;
  }

  setContact(club: string, email: string) {
    this.sql.exec('INSERT INTO booking_club_contacts(club,email) VALUES(?,?) ON CONFLICT(club) DO UPDATE SET email=excluded.email', club, email);
  }

  private creator(bookingId: string) {
    return this.sql.exec<{id: string; email: string}>(
      `SELECT a.id,a.email FROM booking_creators c JOIN (SELECT id,email,verified FROM booking_accounts UNION ALL SELECT id,email,verified FROM booking_sps_accounts) a ON a.id=c.account_id
       WHERE c.booking_id=? AND a.verified=1`, bookingId
    ).toArray()[0];
  }

  private enqueue(event: string, address: string, subject: string, message: string) {
    const now = Date.now();
    const id = createHash('sha256').update(JSON.stringify([event, address])).digest('hex');
    const payload = JSON.stringify({
      from: this.env.EMAIL_FROM, to: [address], subject: '[物院社团预约] ' + subject,
      text: message + '\n\n查看预约日历：' + this.env.FRONTEND_URL
    });
    this.sql.exec('INSERT OR IGNORE INTO booking_mail(id,payload,expires_at,next_at,created_at) VALUES(?,?,?,?,?)',
      id, payload, now + 23 * 3600000, now, now);
  }

  // Called inside the same transaction as the successful calendar change.
  record(actor: AccountUser, change: BookingChange, revision: number) {
    const booking = change.booking;
    const event = `${change.kind}:${revision}:${booking.id}`;
    const operator = `${actor.club} 的 ${actor.username}`;
    if (change.kind === 'created') {
      this.sql.exec('INSERT INTO booking_creators(booking_id,account_id) VALUES(?,?)', booking.id, actor.id);
      if (change.conflicts.length) {
        this.conflicts(event, booking, `${operator}预约了以下活动`, change.conflicts);
      } else {
        const lead = this.contact(booking.club);
        if (lead && lead !== actor.email) {
          this.enqueue(event, lead, '社团成员新增预约 · ' + clean(booking.activity), `${operator}在物院社团预约网站新增了预约。\n\n${describe(booking)}`);
        }
      }
      return;
    }

    const owner = this.creator(booking.id);
    const recipients = new Set([this.contact(booking.club)]);
    if (owner && owner.id !== actor.id) recipients.add(owner.email);
    for (const address of recipients) {
      if (address) this.enqueue(event, address, '社团预约已取消 · ' + clean(booking.activity),
        `以下活动在物院社团预约网站上的预约已被${operator}取消。\n\n${describe(booking)}`);
    }
    this.sql.exec('DELETE FROM booking_creators WHERE booking_id=?', booking.id);
  }

  private conflicts(event: string, incoming: Booking, who: string, existing: Booking[]) {
    // Each inbox sees its relevant activities once, even when several roles or bookings overlap.
    const byAddress = new Map<string, Set<Booking>>();
    const include = (address: string | null | undefined, booking: Booking) => {
      if (!address) return;
      const items = byAddress.get(address) ?? new Set<Booking>();
      items.add(booking);
      byAddress.set(address, items);
    };
    const incomingLead = this.contact(incoming.club);
    for (const prior of existing) {
      include(incomingLead, prior);
      include(this.contact(prior.club), prior);
      include(this.creator(prior.id)?.email, prior);
    }
    for (const [address, items] of byAddress) {
      const description = [...items].map(describe).join('\n\n');
      this.enqueue(event, address, '活动安排冲突 · ' + clean(incoming.activity),
        `${who}：\n${describe(incoming)}\n\n与以下已有预约的时间重叠：\n${description}\n\n请相关社团联系协商活动安排。`);
    }
  }

  // A full SPS snapshot can be retried or contain unchanged events. Only new
  // or rescheduled times can create a new conflict with a website booking.
  recordSpsChanges(previous: SpsSnapshot | undefined, next: SpsSnapshot, bookings: Booking[], revision: number) {
    const first = today();
    const last = bookingEnd(first);
    const byDate = new Map<string, Booking[]>();
    for (const booking of bookings) {
      if (booking.date < first || booking.date > last || booking.club === 'SPS') continue;
      const day = byDate.get(booking.date) ?? [];
      day.push(booking);
      byDate.set(booking.date, day);
    }
    if (!byDate.size) return;
    const old = new Map(previous?.events.map(e => [e.id, e]));
    const changed = next.events.filter(e => {
      const before = old.get(e.id);
      return !before || before.startsAt !== e.startsAt || before.endsAt !== e.endsAt;
    });
    for (const incoming of spsBookings({...next, events: changed}, first, last)) {
      const prior = (byDate.get(incoming.date) ?? []).filter(b => overlaps(b, incoming));
      if (prior.length) this.conflicts(`sps:${revision}:${incoming.id}`, incoming, 'SPS 日程同步了以下活动', prior);
    }
  }
}
