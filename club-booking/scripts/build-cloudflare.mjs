// Build the GitHub Pages frontend using Leafuke's domain for the backend.
process.env.BOOKING_BACKEND='cloudflare';
process.env.BOOKING_API_BASE='https://sysu-phy-club-book.folderrewind.top';
await import('./export-pages.mjs');
