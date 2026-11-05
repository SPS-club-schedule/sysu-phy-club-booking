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
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
import static org.junit.Assume.*;

@RunWith(AndroidJUnit4.class)
public class AccountInstrumentedTest {
 private final Instrumentation instrument=InstrumentationRegistry.getInstrumentation();
 private final Context context=instrument.getTargetContext();
 private MainActivity activity;private WebView web;
 private final AtomicInteger loginStatus=new AtomicInteger(200),logoutStatus=new AtomicInteger(200),logins=new AtomicInteger();
 private JSONObject session() throws Exception {return new JSONObject().put("token","a".repeat(64)).put("expiresAt",System.currentTimeMillis()+3600000)
  .put("user",new JSONObject().put("id","native-test").put("username","native_test").put("club","SPS").put("email","native@example.test").put("emailVerified",true));}
 private WebResourceResponse response(int status,String body){return new WebResourceResponse("application/json","UTF-8",status,status==200?"OK":"Failure",Map.of("Access-Control-Allow-Origin",TrustedSite.ORIGIN,"Access-Control-Allow-Headers","authorization,content-type","Access-Control-Allow-Methods","GET,POST,DELETE,OPTIONS","Cache-Control","no-store"),new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));}
 private void launch() throws Exception {
  assumeFalse("true".equals(InstrumentationRegistry.getArguments().getString("live")));
  assertNull("Credential tests must remain offline",((ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE)).getActiveNetwork());
  new SessionVault(context).clear();
  activity=(MainActivity)instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
  WebViewClient local=activity.createClient();
  instrument.runOnMainSync(()->{
   web.stopLoading();web.setWebViewClient(new WebViewClient(){
    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
     if(!TrustedSite.isApi(request.getUrl().toString()))return local.shouldInterceptRequest(view,request);
     if(request.getMethod().equals("OPTIONS"))return response(200,"{}");
     try{
      String path=request.getUrl().getPath();
      if(path.endsWith("/login")){logins.incrementAndGet();return response(loginStatus.get(),loginStatus.get()==200?new JSONObject().put("ok",true).put("data",session()).toString():"{\"error\":\"用户名或密码不正确\"}");}
      if(path.endsWith("/logout"))return response(logoutStatus.get(),"{\"ok\":true,\"data\":{},\"error\":\"测试：暂时无法退出\"}");
      if(path.endsWith("/me"))return response(200,new JSONObject().put("ok",true).put("data",session()).toString());
      if(path.endsWith("/live-ticket"))return response(200,"{\"ok\":true,\"data\":{\"ticket\":\""+"e".repeat(64)+"\"}}");
      return response(200,"{\"revision\":1,\"today\":\""+java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))+"\",\"bookings\":[],\"curriculum\":{\"version\":1,\"timetables\":[]}}");
     }catch(Exception error){throw new RuntimeException(error);}
    }
   });web.loadUrl(TrustedSite.HOME);
  });
  waitJs("document.querySelector('#auth-name') !== null");
 }
 private String js(String code) throws Exception {CountDownLatch done=new CountDownLatch(1);String[] result=new String[1];instrument.runOnMainSync(()->web.evaluateJavascript(code,value->{result[0]=value;done.countDown();}));assertTrue(done.await(5,TimeUnit.SECONDS));return result[0];}
 private void waitJs(String code) throws Exception {long end=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<end){if("true".equals(js(code)))return;Thread.sleep(40);}fail("Missing page state: "+code+"; "+js("document.body.innerText.slice(0,500)"));}
 private void fillLogin() throws Exception {js("(()=>{const set=(id,value)=>{const el=document.querySelector(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};set('#auth-name','native_test');set('#auth-password','Fictional-password-123')})()");}
 private void submit() throws Exception {js("document.querySelector('.auth-card form').requestSubmit()");}
 private void finish(){if(activity!=null){instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();}new SessionVault(context).clear();}
 @Test public void loginSavesEncryptedPasswordOnlyOnSuccessAndLogoutClearsIt() throws Exception {
  try{
   launch();SessionVault vault=new SessionVault(context);
   assertEquals("true",js("document.querySelector('.auth-remember input').checked"));
   loginStatus.set(401);fillLogin();submit();waitJs("document.querySelector('.auth-error')?.textContent.includes('用户名或密码') === true");
   assertFalse(vault.credentials().has("password"));assertEquals(1,logins.get());
   loginStatus.set(200);submit();waitJs("document.querySelector('.account-strip') !== null");
   assertEquals("Fictional-password-123",vault.credentials().getString("password"));assertEquals(2,logins.get());
   String disk=context.getSharedPreferences("session-vault",Context.MODE_PRIVATE).getAll().toString();
   assertFalse(disk.contains("Fictional-password"));assertFalse(disk.contains("native_test"));assertFalse(disk.contains("a".repeat(64)));
   js("window.__fixtureBeforeReload = true");instrument.runOnMainSync(web::reload);waitJs("window.__fixtureBeforeReload !== true && document.querySelector('.account-strip') !== null");
   assertEquals(2,logins.get());assertEquals("true",js("document.querySelector('#club').disabled && document.querySelector('#club').value === 'SPS'"));
   logoutStatus.set(503);js("document.querySelector('.account-strip > button').click()");waitJs("document.querySelector('.auth-global-error') !== null");assertTrue(vault.credentials().has("password"));
   logoutStatus.set(200);js("document.querySelector('.account-strip > button').click()");waitJs("document.querySelector('#auth-name') !== null");assertFalse(vault.credentials().has("password"));assertFalse(vault.read().has("session"));
   js("window.__fixtureBeforeReload = true");instrument.runOnMainSync(web::reload);waitJs("window.__fixtureBeforeReload !== true && document.querySelector('#auth-name') !== null");assertEquals(2,logins.get());
  }finally{finish();}
 }
 @Test public void uncheckingRememberStoresSessionWithoutPassword() throws Exception {
  try{launch();fillLogin();js("document.querySelector('.auth-remember input').click()");submit();waitJs("document.querySelector('.account-strip') !== null");assertFalse(new SessionVault(context).credentials().has("password"));assertTrue(new SessionVault(context).read().has("session"));}finally{finish();}
 }
 @Test public void savedScheduleIdentityUsesTheScheduleProvider() throws Exception {
  ByteArrayOutputStream submitted=new ByteArrayOutputStream();
  JSONObject expected=session();expected.getJSONObject("user").put("id","sps:"+"b".repeat(64));
  JSONObject result=new JSONObject().put("ok",true).put("data",expected);
  HttpURLConnection connection=new HttpURLConnection(new URL(LoginClient.ENDPOINT)){
   public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
   public int getResponseCode(){return 200;}public java.io.OutputStream getOutputStream(){return submitted;}
   public java.io.InputStream getInputStream(){return new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8));}
  };
  JSONObject signedIn=new LoginClient(()->connection).loginSps("native_test","Fictional-password-123");
  assertEquals(expected.getJSONObject("user").getString("id"),signedIn.getJSONObject("user").getString("id"));
  assertEquals("sps",new JSONObject(submitted.toString("UTF-8")).getString("provider"));
  assertFalse(connection.getInstanceFollowRedirects());
 }
 @Test public void expiredSessionAutoLoginUsesNativePasswordAndNeverReturnsItToPage() throws Exception {
  try{
   launch();fillLogin();submit();waitJs("document.querySelector('.account-strip') !== null");
   SessionVault vault=new SessionVault(context);vault.write(new JSONObject());
   ByteArrayOutputStream submitted=new ByteArrayOutputStream();JSONObject result=new JSONObject().put("ok",true).put("data",session());
   HttpURLConnection connection=new HttpURLConnection(new URL(LoginClient.ENDPOINT)){
    public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
    public int getResponseCode(){return 200;}public java.io.OutputStream getOutputStream(){return submitted;}
    public java.io.InputStream getInputStream(){return new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8));}
   };
   java.lang.reflect.Field client=MainActivity.class.getDeclaredField("loginClient");client.setAccessible(true);client.set(activity,new LoginClient(()->connection));
   java.lang.reflect.Method auto=MainActivity.class.getDeclaredMethod("autoLogin");auto.setAccessible(true);
   instrument.runOnMainSync(()->{try{auto.invoke(activity);}catch(Exception error){throw new RuntimeException(error);}});
   long end=System.currentTimeMillis()+10000;while(!vault.read().has("session")&&System.currentTimeMillis()<end)Thread.sleep(30);
   assertTrue(vault.read().has("session"));assertEquals(TrustedSite.ORIGIN,connection.getRequestProperty("Origin"));assertFalse(connection.getInstanceFollowRedirects());
   assertEquals("Fictional-password-123",new JSONObject(submitted.toString("UTF-8")).getString("password"));
   waitJs("document.querySelector('.account-strip') !== null");
   assertEquals("false",js("sessionStorage.getItem('physics-club-session-v1').includes('Fictional-password')"));
  }finally{finish();}
 }
}
