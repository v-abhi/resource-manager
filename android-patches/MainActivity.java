package com.personal.resourcemanager;

import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // The modern Android back gesture must reach our SPA router rather
    // than causing WebView to navigate or immediately exiting the Activity.
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().post(() ->
          getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new Event('resource-manager:native-back'))", null));
      }
    });

    // API 35+ forces edge-to-edge. StatusBar.setOverlaysWebView(false)
    // alone no longer prevents the web content from drawing beneath icons.
    // Apply the real system bar insets to the native WebView container.
    if (Build.VERSION.SDK_INT >= 35) {
      final View webView = getBridge().getWebView();
      final ViewGroup parent = (ViewGroup) webView.getParent();
      parent.setBackgroundColor(Color.rgb(246, 248, 252));
      getWindow().getDecorView().setBackgroundColor(Color.rgb(246, 248, 252));
      parent.setOnApplyWindowInsetsListener((view, windowInsets) -> {
        Insets insets = windowInsets.getInsets(
          WindowInsets.Type.statusBars() |
          WindowInsets.Type.navigationBars() |
          WindowInsets.Type.displayCutout());
        view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
        // The WebView is physically within the safe area, so do not
        // pass insets down and apply them a second time in CSS.
        return WindowInsets.CONSUMED;
      });
      parent.requestApplyInsets();
    }
  }
}
