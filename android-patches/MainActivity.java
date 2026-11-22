package com.personal.resourcemanager;

import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int BAR_COLOR = Color.rgb(246, 248, 252);
  private boolean backRegistered = false;

  private void sendBackToWeb() {
    if (getBridge() == null || getBridge().getWebView() == null) return;
    getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
        "window.__resourceManagerBack && window.__resourceManagerBack()", null));
  }

  private void makeSystemIconsVisible() {
    getWindow().setStatusBarColor(BAR_COLOR);
    getWindow().setNavigationBarColor(BAR_COLOR);
    // White icons on our almost-white background caused the invisible clock/network issue.
    // LIGHT_STATUS_BAR means DARK foreground icons in Android terminology.
    View decor = getWindow().getDecorView();
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = decor.getWindowInsetsController();
      if (controller != null) {
        controller.setSystemBarsAppearance(
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
      }
    } else {
      decor.setSystemUiVisibility(decor.getSystemUiVisibility() |
          View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR |
          View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    makeSystemIconsVisible();

    // Android 13+ gesture navigation: register with higher priority than the
    // WebView default handler, so navigating between tabs is not swallowed.
    if (Build.VERSION.SDK_INT >= 33) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
          OnBackInvokedDispatcher.PRIORITY_OVERLAY, new OnBackInvokedCallback() {
            @Override public void onBackInvoked() { sendBackToWeb(); }
          });
      backRegistered = true;
    }
    if (!backRegistered) {
      getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
        @Override public void handleOnBackPressed() { sendBackToWeb(); }
      });
    }

    // Android 15+ enforces edge-to-edge. Reserve actual system-bar space;
    // web content must not paint or receive touches behind notification icons.
    if (Build.VERSION.SDK_INT >= 35 && getBridge() != null && getBridge().getWebView() != null) {
      View webView = getBridge().getWebView();
      ViewGroup container = (ViewGroup) webView.getParent();
      container.setBackgroundColor(BAR_COLOR);
      container.setOnApplyWindowInsetsListener((view, windowInsets) -> {
        Insets insets = windowInsets.getInsets(
            WindowInsets.Type.statusBars() |
            WindowInsets.Type.navigationBars() |
            WindowInsets.Type.displayCutout());
        view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
        return WindowInsets.CONSUMED;
      });
      container.requestApplyInsets();
    }
  }

  @Override public void onResume() {
    super.onResume();
    makeSystemIconsVisible();
  }

  @Override public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) makeSystemIconsVisible();
  }
}
