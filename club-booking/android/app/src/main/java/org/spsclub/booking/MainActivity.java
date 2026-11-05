package org.spsclub.booking;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ScriptHandler;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public class MainActivity extends Activity {
    private WebView web;
    private WebView popup;
    private SessionVault vault;
    private ScriptHandler sessionScript;
    private final java.util.concurrent.ExecutorService loginExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
    private LoginClient loginClient=new LoginClient();
    private boolean loginBusy;
    private int loginGeneration;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        vault=new SessionVault(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244,246,241));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText(R.string.app_name); title.setTextColor(Color.rgb(40,95,73)); title.setTextSize(16);
        title.setPadding(dp(16),0,0,0);
        bar.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));
        title.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button menu = new Button(this);
        menu.setText(R.string.menu); menu.setContentDescription(getString(R.string.menu));
        bar.addView(menu,new LinearLayout.LayoutParams(dp(64),dp(48)));
        menu.setOnClickListener(view -> {
            PopupMenu choices = new PopupMenu(this,menu);
            choices.getMenu().add(R.string.refresh).setOnMenuItemClickListener(item -> { confirmReload(); return true; });
            choices.getMenu().add(R.string.open_website).setOnMenuItemClickListener(item -> { openExternal(TrustedSite.WEBSITE); return true; });
            choices.getMenu().add(R.string.about).setOnMenuItemClickListener(item -> {
                new AlertDialog.Builder(this).setTitle(getString(R.string.app_name)+" "+BuildConfig.VERSION_NAME)
                    .setMessage(R.string.about_text).setPositiveButton(R.string.ok,null).show(); return true;
            });
            choices.getMenu().add("清除本机保存的密码").setOnMenuItemClickListener(item->{
                new AlertDialog.Builder(this).setMessage("清除后保留本次登录，登录过期后需重新输入密码。")
                    .setNegativeButton("取消",null).setPositiveButton("清除",(d,w)->{loginGeneration++;loginBusy=false;vault.clearCredentials();Toast.makeText(this,"已清除保存的密码",Toast.LENGTH_SHORT).show();}).show();return true;
            });
            choices.show();
        });
        root.addView(bar);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(244,246,241));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(createClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture) return false;
                if (popup != null) popup.destroy();
                popup = new WebView(MainActivity.this);
                popup.getSettings().setAllowFileAccess(false);
                popup.getSettings().setAllowContentAccess(false);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        openExternal(request.getUrl().toString());
                        child.post(() -> { child.destroy(); if (popup == child) popup = null; });
                        return true;
                    }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return blocked(); }
                });
                ((WebView.WebViewTransport)result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
        });
        root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root);
        if(!configureAccountBridge())return;
        web.loadUrl(TrustedSite.HOME);
        autoLogin();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }

    private boolean configureAccountBridge(){
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)||!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            new AlertDialog.Builder(this).setMessage("请更新 Android System WebView 或 Chrome 后使用 App 登录；也可从菜单打开网页版。")
                .setPositiveButton(R.string.ok,null).show();return false;
        }
        WebViewCompat.addWebMessageListener(web,"BookingNative",Collections.singleton(TrustedSite.ORIGIN),(view,message,origin,mainFrame,reply)->{
            if(!mainFrame||!TrustedSite.ORIGIN.equals(origin.toString())||!TrustedSite.isPage(view.getUrl()))return;
            try{
                String raw=message.getData();if(raw==null||raw.length()>16384)return;
                JSONObject input=new JSONObject(raw);
                switch(input.optString("type")){
                    case "auth-success":
                        loginGeneration++;loginBusy=false;installSession(vault.rememberWebLogin(input));break;
                    case "session":
                        if(loginBusy)return;
                        JSONObject old=vault.credentials(),session=input.optJSONObject("session");
                        if(session!=null&&!session.getJSONObject("user").optString("id").equals(old.optString("accountId")))vault.clearCredentials();
                        installSession(vault.write(input));break;
                    case "logout":
                        loginGeneration++;loginBusy=false;vault.clear();installSession(new JSONObject());break;
                    case "expired":
                        installSession(vault.write(new JSONObject()));autoLogin();break;
                    default: break;
                }
            }catch(Exception invalid){Toast.makeText(this,"本次登录可继续使用，但无法保存到本机",Toast.LENGTH_LONG).show();}
        });
        installSession(vault.read());return true;
    }
    private void installSession(JSONObject value){
        if(sessionScript!=null)sessionScript.remove();
        String snapshot=value.optJSONObject("session")==null?"null":value.optJSONObject("session").toString();
        String script="(()=>{if(window.top!==window||location.origin!=="+JSONObject.quote(TrustedSite.ORIGIN)+"||!["+JSONObject.quote(TrustedSite.PREFIX)+","+JSONObject.quote(TrustedSite.PREFIX+"index.html")+"].includes(location.pathname))return;const session="+snapshot+";if(session&&session.expiresAt>Date.now())sessionStorage.setItem('physics-club-session-v1',JSON.stringify(session));else sessionStorage.removeItem('physics-club-session-v1');})()";
        sessionScript=WebViewCompat.addDocumentStartJavaScript(web,script,Collections.singleton(TrustedSite.ORIGIN));
    }
    private void autoLogin(){
        if(loginBusy||sessionScript==null||vault.read().has("session")||!vault.mayAutoLogin())return;
        JSONObject credentials=vault.credentials();final int generation=++loginGeneration;
        loginBusy=true;vault.delayAutoLogin(60000);
        loginExecutor.execute(()->{
            try{
                String name=credentials.getString("username"), pass=credentials.getString("password");
                JSONObject session=credentials.getString("accountId").startsWith("sps:") ? loginClient.loginSps(name,pass) : loginClient.login(name,pass);
                if (!credentials.getString("accountId").equals(session.getJSONObject("user").getString("id")))
                    throw new LoginClient.Failure(401,"账号已变更，请重新登录");
                runOnUiThread(()->{
                    if(isDestroyed()||generation!=loginGeneration)return;loginBusy=false;
                    try{installSession(vault.write(new JSONObject().put("session",session)));vault.delayAutoLogin(0);web.loadUrl(TrustedSite.HOME);}
                    catch(Exception invalid){vault.clearCredentials();}
                });
            }catch(Exception error){runOnUiThread(()->{
                if(isDestroyed()||generation!=loginGeneration)return;loginBusy=false;
                int status=error instanceof LoginClient.Failure?((LoginClient.Failure)error).status:0;
                if(status==400||status==401||status==403)vault.clearCredentials();
                else vault.delayAutoLogin(status==429?15*60000:60000);
                Toast.makeText(this,status==401?"保存的密码已失效，请重新登录":"自动登录暂未成功，可稍后重试",Toast.LENGTH_LONG).show();
            });}
        });
    }

    // This origin is already allowed by the API. All document bytes come from
    // APK assets; no request to GitHub Pages is allowed through the WebView.
    WebViewClient createClient() {
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().setDomain(TrustedSite.DOMAIN)
            .addPathHandler(TrustedSite.PREFIX, path -> {
                if (!path.isEmpty() && !path.equals("index.html")) return blocked();
                try {
                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control","no-store"), getAssets().open("www/index.html"));
                } catch (java.io.IOException missing) { return blocked(); }
            }).build();
        return new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (TrustedSite.isPage(url) && request.getMethod().equals("GET")) {
                    WebResourceResponse local = loader.shouldInterceptRequest(request.getUrl());
                    return local == null ? blocked() : local;
                }
                if (!request.isForMainFrame() && TrustedSite.isApi(url)) return null;
                return blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && TrustedSite.isPage(request.getUrl().toString())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl().toString());
                return true;
            }
        };
    }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
    }
    private void openExternal(String value) {
        if (!TrustedSite.isExternal(value)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(value)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException unavailable) { Toast.makeText(this,R.string.no_browser,Toast.LENGTH_LONG).show(); }
    }
    private void confirmReload() {
        new AlertDialog.Builder(this).setTitle(R.string.refresh).setMessage(R.string.reload_message)
            .setNegativeButton(R.string.keep,null).setPositiveButton(R.string.refresh,(d,w) -> web.loadUrl(TrustedSite.HOME)).show();
    }
    private void handleBack() {
        // Dispatch the same cancel event as Escape, so React can dismiss its
        // dialog and preserve the two-step cancellation/busy guards.
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.dispatchEvent(new Event('cancel',{cancelable:true}));return true}return false})()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }
    // API 33+ uses OnBackInvokedDispatcher above; this is the older-device path.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onResume() { super.onResume(); if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('focus'))",null);autoLogin();} }
    @Override protected void onPause() { if(web!=null)web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { loginGeneration++;loginExecutor.shutdownNow();if(sessionScript!=null)sessionScript.remove();if(popup!=null)popup.destroy();if(web!=null){((LinearLayout)web.getParent()).removeView(web);web.destroy();}super.onDestroy(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
