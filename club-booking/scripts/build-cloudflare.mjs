// This selects Cloudflare without changing the default production build before cutover.
process.env.BOOKING_BACKEND='cloudflare';
process.env.BOOKING_API_BASE='https://sysu-phy-club-book.folderrewind.top';
await import('./export-pages.mjs');
