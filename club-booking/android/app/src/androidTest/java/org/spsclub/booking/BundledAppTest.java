package org.spsclub.booking;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
import static org.junit.Assume.*;

@RunWith(AndroidJUnit4.class)
public class BundledAppTest {
    private final Instrumentation instrument = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrument.getTargetContext();
    private final AtomicInteger reads = new AtomicInteger(), revision = new AtomicInteger(1), status = new AtomicInteger(200);
    private MainActivity activity;
    private WebView web;
    private boolean live() { return "true".equals(InstrumentationRegistry.getArguments().getString("live")); }

    private void launch(boolean fixture) throws Exception {
        if (fixture) assertNull("Fixture tests must run on an offline emulator", ((ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE)).getActiveNetwork());
        new SessionVault(context).clear();
        if(fixture)new SessionVault(context).write(new JSONObject().put("session",testSession()));
        activity = (MainActivity) instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        java.lang.reflect.Field field = MainActivity.class.getDeclaredField("web"); field.setAccessible(true); web = (WebView) field.get(activity);
        if (fixture) {
            WebViewClient local = activity.createClient();
            instrument.runOnMainSync(() -> {
                web.stopLoading();
                web.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (TrustedSite.isApi(request.getUrl().toString())) {
                            if(request.getMethod().equals("OPTIONS"))return reply(200,"{}");
                            reads.incrementAndGet();
                            if(request.getUrl().getPath().startsWith("/api/auth/"))try{
                                JSONObject data=request.getUrl().getPath().endsWith("live-ticket")?new JSONObject().put("ticket","e".repeat(64)):testSession();
                                return reply(200,new JSONObject().put("ok",true).put("data",data).toString());
                            }catch(Exception error){throw new RuntimeException(error);}
                            try { return reply(status.get(), status.get() == 200 ? snapshot().toString() : "{\"error\":\"测试：连接暂时不可用\"}"); }
                            catch (Exception error) { throw new RuntimeException(error); }
                        }
                        return local.shouldInterceptRequest(view,request);
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return local.shouldOverrideUrlLoading(view,request); }
                });
                web.loadUrl(TrustedSite.HOME);
            });
        }
        awaitJs("document.querySelector('h1')?.textContent === '"+(fixture?"社团活动预约":"登录")+"'",15000);
    }
    private JSONObject testSession() throws Exception {return new JSONObject().put("token","a".repeat(64)).put("expiresAt",System.currentTimeMillis()+3600000)
        .put("user",new JSONObject().put("id","test-user").put("username","test_user").put("club","SPS").put("email","user@example.test").put("emailVerified",true));}
    private JSONObject snapshot() throws Exception {
        LocalDate date = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        JSONObject course = new JSONObject().put("id","test-course").put("name","测试课程"+revision.get())
            .put("weekday",date.getDayOfWeek().getValue()).put("weeks",new JSONArray("[1]"))
            .put("start","10:10").put("end","11:50").put("location","测试教室")
            .put("audiences",new JSONArray("[{\"major\":\"physics\",\"group\":\"all\",\"requirement\":\"required\"}]"));
        JSONObject table = new JSONObject().put("id","grade3-test").put("label","大三").put("grade",3).put("term","测试学期")
            .put("week1Monday",date.minusDays(date.getDayOfWeek().getValue()-1).toString())
            .put("courses",new JSONArray().put(course)).put("overrides",new JSONArray());
        JSONArray bookings = new JSONArray();
        for (String club : new String[]{"torchwood","学生会"}) bookings.put(new JSONObject()
            .put("id","fixture-"+club).put("club",club).put("activity","测试活动"+club).put("location","测试地点")
            .put("date",date.toString()).put("start","18:00").put("end","19:00"));
        return new JSONObject().put("today",date.toString()).put("revision",revision.get()).put("bookings",bookings)
            .put("curriculum",new JSONObject().put("version",1).put("timetables",new JSONArray().put(table)));
    }
    private WebResourceResponse reply(int code,String value) {
        return new WebResourceResponse("application/json","UTF-8",code,code==200?"OK":"Unavailable",
            Map.of("Access-Control-Allow-Origin",TrustedSite.ORIGIN,"Cache-Control","no-store","Access-Control-Allow-Headers","authorization,content-type","Access-Control-Allow-Methods","GET,POST,DELETE,OPTIONS"),
            new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }
    private String js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); String[] value = new String[1];
        instrument.runOnMainSync(() -> web.evaluateJavascript(script,result -> { value[0]=result; done.countDown(); }));
        assertTrue(done.await(5,TimeUnit.SECONDS)); return value[0];
    }
    private void awaitJs(String expression,long timeout) throws Exception {
        long end=System.currentTimeMillis()+timeout;
        while(System.currentTimeMillis()<end) { if("true".equals(js(expression))) return; Thread.sleep(50); }
        fail("Missing page state: "+expression+"; body="+js("document.body.innerText.slice(0,1800)"));
    }
    private void finish() { if(activity!=null){instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();} }

    @Test public void bundledUiWorksOfflineAndRendersFreshCourseAndOtherClubData() throws Exception {
        assumeFalse(live());
        try {
            launch(true);
            awaitJs("document.querySelectorAll('.booking:not(.course-booking)').length === 2",10000);
            assertEquals("true",js("document.body.innerText.includes('测试活动torchwood') && document.body.innerText.includes('测试活动学生会')"));
            js("document.querySelector('.grade-options input').click()");
            awaitJs("document.querySelector('.course-booking')?.textContent.includes('测试课程1') === true",5000);
            js("document.querySelector('.course-booking').click()");
            awaitJs("document.querySelector('dialog[open]') !== null",5000);
            instrument.runOnMainSync(activity::onBackPressed);
            awaitJs("document.querySelector('dialog[open]') === null",5000);
            revision.incrementAndGet(); js("document.querySelector('.calendar-refresh').click()");
            awaitJs("document.querySelector('.course-booking')?.textContent.includes('测试课程2') === true",5000);
            assertTrue(reads.get()>=2);
            assertEquals("true",js("Array.from(document.scripts).every(s=>!s.src)"));
            assertEquals("true",js("document.documentElement.scrollWidth <= innerWidth"));
            assertEquals("true",js("location.href === '"+TrustedSite.HOME+"'"));
        } finally { finish(); }
    }
    @Test public void readFailureKeepsLocalInterfaceAndRetryRecovers() throws Exception {
        assumeFalse(live()); status.set(503);
        try {
            launch(true); awaitJs("document.querySelector('.load-error')?.textContent.includes('连接暂时不可用') === true",10000);
            status.set(200); js("document.querySelector('.load-error button').click()");
            awaitJs("document.querySelector('.load-error') === null && document.querySelectorAll('.booking').length === 2",5000);
        } finally { finish(); }
    }
    @Test public void coldStartWithoutNetworkStillLoadsBundledUi() throws Exception {
        assumeFalse(live());
        assertNull(((ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE)).getActiveNetwork());
        try {
            launch(false);
            awaitJs("document.querySelector('#auth-name') !== null && document.querySelector('#auth-password') !== null",10000);
            assertEquals("true",js("document.querySelectorAll('script[src],link[rel=stylesheet]').length === 0"));
        } finally { finish(); }
    }
    @Test public void productionGuestStartsAtLoginOnBundledOrigin() throws Exception {
        assumeTrue(live());
        try {
            launch(false);
            awaitJs("document.querySelector('#auth-name') !== null",10000);
            assertEquals("true",js("document.querySelector('.calendar-grid') === null"));
            assertEquals("true",js("document.querySelector('.load-error') === null"));
            assertEquals("true",js("location.href === '"+TrustedSite.HOME+"'"));
        } finally { finish(); }
    }
}
