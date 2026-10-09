package io.corilo.app;

import android.app.*;
import android.content.*;
import android.os.IBinder;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

@android.annotation.TargetApi(35)
public final class HostService extends Service {
    static volatile String status="尚未启动", url=null;
    static volatile boolean starting=false;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile Process process;
    private volatile boolean stopping=false;
    static final String STOP="io.corilo.app.STOP";
    @Override public void onCreate(){
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("host","Corilo 本机服务",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null && STOP.equals(intent.getAction())){stopHost();return START_NOT_STICKY;}
        startForeground(1,notification());
        if(!starting && process==null && !stopping){starting=true;worker.execute(this::launch);}
        return START_NOT_STICKY;
    }
    private Notification notification(){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"host").setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("Corilo 可里").setContentText(status).setContentIntent(open).setOngoing(true).build();
    }
    private void report(String value){status=value;getSystemService(NotificationManager.class).notify(1,notification());}
    private void launch(){
        try {
            report("正在准备本机运行环境…");
            File application=new RuntimeInstaller(this).prepare(this::report);
            if(stopping)return;
            File home=new File(getFilesDir(),"home"), temp=new File(RuntimeInstaller.PREFIX,"tmp");home.mkdirs();temp.mkdirs();
            ProcessBuilder builder=new ProcessBuilder(RuntimeInstaller.PREFIX+"/bin/node",new File(application,"app/host/android.mjs").getAbsolutePath());
            builder.directory(home);
            Map<String,String> env=builder.environment();
            env.put("HOME",home.getAbsolutePath());env.put("PREFIX",RuntimeInstaller.PREFIX);
            env.put("PATH",RuntimeInstaller.PREFIX+"/bin:/system/bin");
            env.put("TMPDIR",temp.getAbsolutePath());env.put("LANG","C.UTF-8");
            env.put("LD_LIBRARY_PATH",RuntimeInstaller.PREFIX+"/lib");
            File preload=new File(RuntimeInstaller.PREFIX,"lib/libtermux-exec.so");
            if(preload.isFile())env.put("LD_PRELOAD",preload.getAbsolutePath());
            env.put("SSL_CERT_FILE",RuntimeInstaller.PREFIX+"/etc/tls/cert.pem");
            env.put("GIT_SSL_CAINFO",RuntimeInstaller.PREFIX+"/etc/tls/cert.pem");
            env.put("CORILO_ANDROID_FILES",getFilesDir().getAbsolutePath());
            // Same Pi ~/.pi/agent config, no Android model form or second auth store.
            env.put("SHELL",RuntimeInstaller.PREFIX+"/bin/bash");
            report("正在启动知识库…");
            Process child=builder.start();process=child;
            Thread startupDeadline=new Thread(()->{
                try{Thread.sleep(30000);if(child.isAlive() && url==null && !stopping){report("宿主未能在 30 秒内就绪，请重试");child.destroy();}}catch(InterruptedException ignored){}
            }); startupDeadline.setDaemon(true);startupDeadline.start();
            // Discard stderr rather than persist model/tool output or credentials to logcat.
            Thread stderr=new Thread(()->{try(InputStream in=child.getErrorStream()){in.transferTo(OutputStream.nullOutputStream());}catch(IOException ignored){}});stderr.start();
            Thread output=new Thread(()->readReady(child));output.start();
            int code=child.waitFor(); startupDeadline.interrupt();output.join();stderr.join();
            process=null;url=null;
            if(!stopping)report("宿主已停止（"+code+"）；点击重试。已保存文件保留在本机。");
        }catch(Exception e){if(!stopping)report("启动失败："+e.getMessage());}
        finally {starting=false;if(stopping){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}}
    }
    private void readReady(Process child){
        try(BufferedReader reader=new BufferedReader(new InputStreamReader(child.getInputStream()))){
            String line;
            while((line=reader.readLine())!=null){
                // Stdout is private, never log the session URL or arbitrary Agent output.
                if(!line.startsWith("{\"event\":\"corilo-ready\""))continue;
                JSONObject event=new JSONObject(line);String candidate=event.getString("url");
                if(!candidate.matches("http://127\\.0\\.0\\.1:[0-9]+/#token=[0-9a-f]{64}"))throw new IOException("无效本机地址");
                if(!stopping){url=candidate;report("本机知识库正在运行；后台可能被系统暂停");}
            }
        }catch(Exception e){if(!stopping)report("无法读取宿主启动结果，请重试");}
    }
    private void stopHost(){
        stopping=true;url=null;report("正在停止并保存本机历史…");
        Process child=process;
        if(child!=null)child.destroy(); // SIGTERM: host awaits Pi abort/checkpoint and current sync.
        else if(!starting){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    }
    @Override public void onDestroy(){stopping=true;Process child=process;if(child!=null)child.destroy();worker.shutdown();url=null;super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
