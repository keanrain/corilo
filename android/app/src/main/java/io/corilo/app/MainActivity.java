package io.corilo.app;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.widget.*;
import android.view.View;

@android.annotation.TargetApi(35)
public final class MainActivity extends Activity {
    private WebView web;
    private TextView status;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private String loaded=null, origin=null;
    private boolean supported=false;
    private final Runnable refresh=new Runnable(){public void run(){
        status.setText(HostService.status);
        String ready=HostService.url;
        if(ready!=null && !ready.equals(loaded)) {
            loaded=ready;Uri uri=Uri.parse(ready);origin="http://127.0.0.1:"+uri.getPort();web.loadUrl(ready);
        }
        handler.postDelayed(this,500);
    }};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
        status=new TextView(this);status.setPadding(16,12,16,12);layout.addView(status);
        LinearLayout controls=new LinearLayout(this);
        Button retry=new Button(this);retry.setText("启动 / 重试");retry.setOnClickListener(v->startHost());controls.addView(retry);
        Button stop=new Button(this);stop.setText("停止服务");stop.setOnClickListener(v->requestStop());controls.addView(stop);
        layout.addView(controls);
        web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        if(Build.VERSION.SDK_INT<35 || !java.util.Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")){
            status.setText("首版支持 Android 15 或更新版本的 ARM64 设备");retry.setEnabled(false);return;
        }
        supported=true;
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(allowed(uri))return false;
                // External links never inherit the local session or execute inside this WebView.
                if(request.hasGesture() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    new AlertDialog.Builder(MainActivity.this).setMessage("在外部浏览器打开此链接？").setNegativeButton("取消",null).setPositiveButton("打开",(d,w)->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){}}).show();
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(allowed(request.getUrl()))return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new java.io.ByteArrayInputStream(new byte[0]));
            }
        });
        startHost();
    }
    private boolean allowed(Uri uri){return origin!=null && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && origin.equals("http://127.0.0.1:"+uri.getPort());}
    private void startHost(){loaded=null;startForegroundService(new Intent(this,HostService.class));}
    private void requestStop(){
        web.evaluateJavascript("(() => typeof editor !== 'undefined' && [editor,editor2].some(e => e && e.path && !e.isClean()))()",dirty->{
            if("true".equals(dirty)){new AlertDialog.Builder(this).setMessage("仍有未保存草稿，请先保存或另存后停止服务。").setPositiveButton("返回",null).show();return;}
            new AlertDialog.Builder(this).setMessage("停止本机服务？正在执行的 Agent 将中断，已完成的修改保留。同步任务结束后退出。").setNegativeButton("取消",null).setPositiveButton("停止",(d,w)->startService(new Intent(this,HostService.class).setAction(HostService.STOP))).show();
        });
    }
    @Override protected void onResume(){super.onResume();if(supported)handler.post(refresh);}
    @Override protected void onPause(){handler.removeCallbacks(refresh);super.onPause();}
    @Override protected void onDestroy(){handler.removeCallbacks(refresh);web.destroy();super.onDestroy();}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
}
