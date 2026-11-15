package io.corilo.app;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;
import java.util.zip.*;

/** Own installer for a source-built Termux runtime; never installs com.termux binaries. */
@android.annotation.TargetApi(35)
final class RuntimeInstaller {
    static final String PREFIX = "/data/data/io.corilo.app/files/usr";
    private final Context context;
    RuntimeInstaller(Context context) { this.context = context; }
    File prepare(Consumer<String> progress) throws Exception {
        if (!new File(context.getFilesDir(), "usr").getCanonicalPath().equals(new File(PREFIX).getCanonicalPath()))
            throw new IOException("当前用户空间与运行环境前缀不一致；暂不支持工作资料或多用户空间");
        JSONObject manifest;
        try (InputStream in=context.getAssets().open("payload.json")) { manifest=new JSONObject(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)); }
        if (!"io.corilo.app".equals(manifest.getString("applicationId")) || !PREFIX.equals(manifest.getString("prefix"))) throw new IOException("运行环境标识不匹配");
        File runtime=install("runtime", "usr", manifest.getJSONObject("runtime").getString("sha256"), progress);
        File app=install("app", "application", manifest.getJSONObject("app").getString("sha256"), progress);
        for (String executable:new String[]{"node","git","bash"}) if (!new File(runtime,"bin/"+executable).canExecute()) throw new IOException("运行组件缺失："+executable);
        return app;
    }
    private File install(String asset, String directory, String expected, Consumer<String> progress) throws Exception {
        File root=context.getFilesDir(), current=new File(root,directory), staging=new File(root,directory+"-staging"), previous=new File(root,directory+"-previous");
        // Recover interrupted promotion without touching knowledge, home or config.
        if (!current.exists() && previous.exists()) Files.move(previous.toPath(),current.toPath());
        File marker=new File(current,".corilo-sha256");
        if (marker.isFile() && new String(Files.readAllBytes(marker.toPath()), java.nio.charset.StandardCharsets.UTF_8).equals(expected)) return current;
        progress.accept("正在校验并安装 "+asset+"…");
        File archive=new File(context.getCacheDir(),asset+".zip");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try (InputStream in=context.getAssets().open(asset+".zip"); OutputStream out=new FileOutputStream(archive)) {
            byte[] buffer=new byte[65536]; int n;
            while ((n=in.read(buffer))!=-1) {digest.update(buffer,0,n);out.write(buffer,0,n);}
        }
        StringBuilder actual=new StringBuilder(); for(byte b:digest.digest())actual.append(String.format("%02x",b));
        if (!expected.equals(actual.toString())) throw new IOException("运行组件校验失败，请重新安装完整 APK");
        remove(staging.toPath()); Files.createDirectories(staging.toPath());
        extract(archive.toPath(),staging.toPath(),directory.equals("usr")?PREFIX:current.getAbsolutePath());
        Files.write(new File(staging,".corilo-sha256").toPath(),expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        remove(previous.toPath());
        if(current.exists())Files.move(current.toPath(),previous.toPath());
        try { Files.move(staging.toPath(),current.toPath()); }
        catch(Exception e) { if(previous.exists())Files.move(previous.toPath(),current.toPath()); throw e; }
        remove(previous.toPath()); Files.deleteIfExists(archive.toPath()); return current;
    }
    static void extract(Path archive, Path root, String prefix) throws IOException {
        Set<Path> seen=new HashSet<>(); String links=null; long total=0;
        try(ZipInputStream zip=new ZipInputStream(Files.newInputStream(archive))) {
            ZipEntry entry; byte[] buffer=new byte[65536];
            while((entry=zip.getNextEntry())!=null) {
                Path target=checked(root,entry.getName());
                if(!seen.add(target))throw new IOException("归档包含重复路径");
                if(entry.isDirectory()){Files.createDirectories(target);continue;}
                Files.createDirectories(target.getParent());
                try(OutputStream out=Files.newOutputStream(target,StandardOpenOption.CREATE_NEW)) {
                    int n;while((n=zip.read(buffer))!=-1){ total+=n;if(total>2L*1024*1024*1024)throw new IOException("归档展开超限");out.write(buffer,0,n); }
                }
                target.toFile().setExecutable(true,true);
                if(entry.getName().equals("SYMLINKS.txt"))links=new String(Files.readAllBytes(target), java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        // Create links after all ordinary entries, so archive paths cannot traverse a link.
        if(links!=null) for(String line:links.split("\n")) {
            if(line.isEmpty())continue;
            String[] pair=line.split("←",-1);if(pair.length!=2)throw new IOException("无效符号链接记录");
            Path link=checked(root,pair[1]), destination=Path.of(pair[0]);
            Path finalLink=Path.of(prefix).resolve(root.relativize(link));
            Path finalTarget=(destination.isAbsolute()?destination:finalLink.getParent().resolve(destination)).normalize();
            if(!finalTarget.startsWith(Path.of(prefix)))throw new IOException("符号链接超出运行目录");
            for(Path parent=link.getParent(); !parent.equals(root); parent=parent.getParent())
                if(Files.isSymbolicLink(parent))throw new IOException("符号链接父目录不安全");
            Files.createDirectories(link.getParent());Files.createSymbolicLink(link,destination);
        }
        Files.deleteIfExists(root.resolve("SYMLINKS.txt"));
    }
    static Path checked(Path root,String name) throws IOException {
        Path target=root.resolve(name).normalize();
        if(name.contains("\\") || name.startsWith("/") || !target.startsWith(root) || target.equals(root))throw new IOException("归档路径不安全");
        return target;
    }
    static void remove(Path path) throws IOException {
        if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS))return;
        if(Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))try(var entries=Files.list(path)){for(Path child:entries.toList())remove(child);}
        Files.delete(path);
    }
}
