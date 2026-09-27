package app.aemeath.mobile;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    private static final String RELEASE_API="https://api.github.com/repos/kurosakijin/Aemeath/releases/latest";
    private long updateDownload=-1;
    private File updateFile;
    private final BroadcastReceiver downloadReceiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){if(intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID,-1)==updateDownload)installDownloadedUpdate();}};

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        ContextCompat.registerReceiver(this,downloadReceiver,new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),ContextCompat.RECEIVER_NOT_EXPORTED);
        new android.os.Handler(getMainLooper()).postDelayed(this::checkForUpdate,4000);
    }
    @Override public void onDestroy(){try{unregisterReceiver(downloadReceiver);}catch(Exception ignored){}super.onDestroy();}
    @Override public void onResume(){super.onResume();if(updateFile!=null&&updateFile.exists())installDownloadedUpdate();}

    private void checkForUpdate(){new Thread(()->{
        try{
            HttpURLConnection connection=(HttpURLConnection)new URL(RELEASE_API).openConnection();connection.setRequestProperty("Accept","application/vnd.github+json");connection.setRequestProperty("User-Agent","Aemeath-Android/"+BuildConfig.VERSION_NAME);connection.setConnectTimeout(10000);connection.setReadTimeout(10000);
            BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream()));StringBuilder json=new StringBuilder();String line;while((line=reader.readLine())!=null)json.append(line);reader.close();
            JSONObject release=new JSONObject(json.toString());String version=release.getString("tag_name").replaceFirst("^v","");if(!newer(version,BuildConfig.VERSION_NAME))return;
            JSONArray assets=release.getJSONArray("assets");String download=null;for(int i=0;i<assets.length();i++){JSONObject asset=assets.getJSONObject(i);if("Aemeath-Android.apk".equals(asset.getString("name"))){download=asset.getString("browser_download_url");break;}}
            if(download!=null){String url=download;runOnUiThread(()->new AlertDialog.Builder(this).setTitle("Aemeath update available").setMessage("Version "+version+" is ready. Download and install it now?").setNegativeButton("Later",null).setPositiveButton("Update",(dialog,which)->downloadUpdate(url)).show());}
        }catch(Exception ignored){}
    }).start();}
    private boolean newer(String latest,String current){String[] a=latest.split("\\."),b=current.split("\\.");for(int i=0;i<Math.max(a.length,b.length);i++){int x=i<a.length?number(a[i]):0,y=i<b.length?number(b[i]):0;if(x!=y)return x>y;}return false;}
    private int number(String value){try{return Integer.parseInt(value.replaceAll("[^0-9].*$",""));}catch(Exception ignored){return 0;}}
    private void downloadUpdate(String url){
        updateFile=new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),"Aemeath-update.apk");if(updateFile.exists())updateFile.delete();
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url)).setTitle("Aemeath update").setDescription("Downloading the latest version").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED).setDestinationUri(Uri.fromFile(updateFile));
        updateDownload=((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
    }
    private void installDownloadedUpdate(){
        if(updateFile==null||!updateFile.exists())return;
        if(android.os.Build.VERSION.SDK_INT>=26&&!getPackageManager().canRequestPackageInstalls()){startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));return;}
        Uri apk=FileProvider.getUriForFile(this,getPackageName()+".fileprovider",updateFile);Intent install=new Intent(Intent.ACTION_VIEW).setDataAndType(apk,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);startActivity(install);
    }
}
