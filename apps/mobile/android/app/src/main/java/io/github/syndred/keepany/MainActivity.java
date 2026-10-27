package io.github.syndred.keepany;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAnyMetadataPlugin.class);
        registerPlugin(KeepAnyFilesPlugin.class);
        registerPlugin(KeepAnyIdentityPlugin.class);
        registerPlugin(KeepAnyConnectionsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
