package io.corilo.app;
import java.nio.file.*;
import java.io.*;
import java.util.zip.*;

/** Host-JVM checks for archive boundaries, not Android device execution. */
public final class InstallerChecks {
    static Path archive(Path base,String name,String[][] entries)throws Exception{
        Path file=base.resolve(name);
        try(ZipOutputStream zip=new ZipOutputStream(Files.newOutputStream(file))){for(String[] entry:entries){zip.putNextEntry(new ZipEntry(entry[0]));zip.write(entry[1].getBytes());zip.closeEntry();}}
        return file;
    }
    static void rejected(Path archive,Path target)throws Exception{
        Files.createDirectories(target);
        try{RuntimeInstaller.extract(archive,target,"/data/data/io.corilo.app/files/usr");throw new AssertionError("unsafe archive accepted");}catch(IOException expected){}
    }
    public static void main(String[] args)throws Exception{
        Path temp=Files.createTempDirectory("corilo-installer-");
        try{
            Path root=temp.resolve("runtime");Files.createDirectories(root);
            RuntimeInstaller.extract(archive(temp,"good.zip",new String[][]{{"bin/bash","synthetic executable"},{"SYMLINKS.txt","bash←bin/sh\n"}}),root,"/data/data/io.corilo.app/files/usr");
            if(!Files.isSymbolicLink(root.resolve("bin/sh"))||!Files.readString(root.resolve("bin/sh")).equals("synthetic executable"))throw new AssertionError("link not restored");
            if(!Files.isExecutable(root.resolve("bin/bash")))throw new AssertionError("executable bit missing");
            rejected(archive(temp,"escape.zip",new String[][]{{"../outside","escape"}}),temp.resolve("escape"));
            if(Files.exists(temp.resolve("outside")))throw new AssertionError("archive escaped root");
            rejected(archive(temp,"link.zip",new String[][]{{"SYMLINKS.txt","/data/data/io.corilo.app/files/knowledge←bad\n"}}),temp.resolve("badlink"));
            rejected(archive(temp,"nested-link.zip",new String[][]{{"SYMLINKS.txt","bin←alias\nbash←alias/sh\n"}}),temp.resolve("nestedlink"));
            Path outside=temp.resolve("notes");Files.createDirectories(outside);Files.writeString(outside.resolve("keep.md"),"preserve");
            Path cleanup=temp.resolve("cleanup");Files.createDirectories(cleanup);Files.createSymbolicLink(cleanup.resolve("link"),outside);
            RuntimeInstaller.remove(cleanup);
            if(!Files.readString(outside.resolve("keep.md")).equals("preserve"))throw new AssertionError("cleanup followed a link");
            System.out.println("Installer host checks passed: extract/permissions/links, traversal rejection, external-link rejection, cleanup preserves external data");
        }finally{RuntimeInstaller.remove(temp);}
    }
}
