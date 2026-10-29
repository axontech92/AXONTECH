package com.kiu.agent;

import android.webkit.WebView;

/* loaded from: classes.dex */
public class KiuJsPost implements Runnable {
    private String js;

    public KiuJsPost(String str) {
        this.js = str;
    }

    @Override // java.lang.Runnable
    public void run() {
        WebView webView;
        String str;
        try {
            MainActivity mainActivity = MainActivity.inst;
            if (mainActivity == null || (webView = mainActivity.web) == null || (str = this.js) == null) {
                return;
            }
            webView.evaluateJavascript(str, null);
        } catch (Throwable th) {
        }
    }
}
