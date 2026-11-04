package org.spsclub.booking;

import java.net.URI;
import java.util.Set;

final class TrustedSite {
    static final String DOMAIN = "sps-club-schedule.github.io";
    static final String ORIGIN = "https://" + DOMAIN;
    static final String PREFIX = "/sysu-phy-club-booking/__android__/";
    static final String HOME = ORIGIN + PREFIX + "index.html";
    static final String WEBSITE = ORIGIN + "/sysu-phy-club-booking/";
    static final String API_HOST = "sysu-phy-club-book.folderrewind.top";
    private static final Set<String> API_PATHS = Set.of("/api/bookings", "/api/curriculum", "/api/health", "/api/updates",
        "/api/auth/config", "/api/auth/register", "/api/auth/login", "/api/auth/me", "/api/auth/logout",
        "/api/auth/verify", "/api/auth/resend", "/api/auth/reset-request", "/api/auth/reset", "/api/auth/live-ticket");

    private static URI https(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null &&
                (uri.getPort() == -1 || uri.getPort() == 443) ? uri : null;
        } catch (Exception ignored) { return null; }
    }
    static boolean isPage(String value) {
        URI uri = https(value);
        return uri != null && DOMAIN.equals(uri.getHost()) && uri.getRawQuery() == null &&
            (PREFIX.equals(uri.getRawPath()) || (PREFIX + "index.html").equals(uri.getRawPath()));
    }
    static boolean isApi(String value) {
        URI uri = https(value);
        return uri != null && API_HOST.equals(uri.getHost()) && API_PATHS.contains(uri.getRawPath()) && uri.getRawQuery() == null;
    }
    static boolean isExternal(String value) { return https(value) != null && !isPage(value); }
    private TrustedSite() {}
}
