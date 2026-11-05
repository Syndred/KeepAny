package io.github.syndred.keepany;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAnyMetadataPlugin.class);
        registerPlugin(KeepAnyFilesPlugin.class);
        registerPlugin(KeepAnyConnectionsPlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
