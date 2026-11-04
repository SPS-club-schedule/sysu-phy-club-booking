package org.spsclub.booking;

import org.junit.Test;
import static org.junit.Assert.*;

public class TrustedSiteTest {
    @Test public void onlyBundledEntryIsInternal() {
        assertTrue(TrustedSite.isPage(TrustedSite.HOME));
        assertTrue(TrustedSite.isPage(TrustedSite.ORIGIN + TrustedSite.PREFIX));
        assertTrue(TrustedSite.isPage(TrustedSite.HOME + "#section"));
        for (String value : new String[]{TrustedSite.WEBSITE, TrustedSite.HOME + "?x=1",
            TrustedSite.HOME.replace("https:", "http:"), TrustedSite.HOME.replace("github.io", "github.io.evil.test"),
            TrustedSite.HOME.replace("https://", "https://user@"), TrustedSite.HOME.replace(".io/", ".io:444/"),
            TrustedSite.HOME.replace("index.html", "%69ndex.html"), TrustedSite.HOME.replace("index.html", "../index.html"),
            "file:///android_asset/www/index.html", "javascript:alert(1)", "intent://foo", "data:text/html,test", null}) {
            assertFalse(value, TrustedSite.isPage(value));
        }
    }
    @Test public void networkIsLimitedToPublicApi() {
        for (String path : new String[]{"bookings", "curriculum", "health", "updates"})
            assertTrue(TrustedSite.isApi("https://" + TrustedSite.API_HOST + "/api/" + path));
        for (String value : new String[]{TrustedSite.WEBSITE, "https://" + TrustedSite.API_HOST + "/__migration",
            "https://" + TrustedSite.API_HOST + "/api/integrations/sps", "https://" + TrustedSite.API_HOST + "/api/bookings?test=1",
            "http://" + TrustedSite.API_HOST + "/api/bookings", "https://evil.test/api/bookings"})
            assertFalse(value, TrustedSite.isApi(value));
        assertTrue(TrustedSite.isExternal(TrustedSite.WEBSITE));
        assertTrue(TrustedSite.isExternal(TrustedSite.ORIGIN + "/sps-club-schedule/#/task?id=test"));
        assertFalse(TrustedSite.isExternal("javascript:alert(1)"));
    }
}
