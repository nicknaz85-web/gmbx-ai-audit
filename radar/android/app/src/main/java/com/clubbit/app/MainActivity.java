package com.clubbit.app;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor 8 + target SDK 35/36: Android enforces edge-to-edge, so the
        // WebView draws under the status/navigation bars. Enabling edge-to-edge here
        // lets Capacitor's SystemBars inset handling populate env(safe-area-inset-*)
        // so the app's headers/nav (which already use those vars) sit clear of them.
        // (Becomes automatic in Capacitor 9.)
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
