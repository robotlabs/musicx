package io.github.robotlabs.musicx;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Il plugin per "Trasmetti" sta nell'app stessa: va registrato prima che parta il ponte.
        registerPlugin(MusicCastPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
