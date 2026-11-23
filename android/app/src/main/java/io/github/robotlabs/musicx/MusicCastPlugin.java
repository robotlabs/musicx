package io.github.robotlabs.musicx;

import android.content.Context;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * "Trasmetti": le due cose per le casse di casa che la pagina non sa fare da sola.
 * - discover: trova le casse con SSDP (UDP multicast) e chiedendo l'API Yamaha a tutta la rete /24 del Wi-Fi.
 * - resolve: l'IPv4 di un server di pCloud. Le casse MusicCast suonano i link solo con l'IP numerico
 *   (il loro DLNA non risolve i nomi).
 * Comandi e richieste alle casse passano invece da CapacitorHttp (per questo l'app ammette l'http in chiaro).
 */
@CapacitorPlugin(name = "MusicCast")
public class MusicCastPlugin extends Plugin {

    private static final String SSDP_SEARCH =
        "M-SEARCH * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        "MAN: \"ssdp:discover\"\r\n" +
        "MX: 2\r\n" +
        "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";

    private final ExecutorService pool = Executors.newCachedThreadPool();

    @PluginMethod
    public void discover(PluginCall call) {
        int timeoutMs = Math.min(call.getInt("timeoutMs", 2500), 8000);
        pool.execute(() -> {
            // ip -> descrizione UPnP ("" se trovata solo con l'API Yamaha).
            Map<String, String> found = new ConcurrentHashMap<>();
            Future<?> scan = pool.submit(() -> scanYamaha(found, 1200));
            ssdp(found, timeoutMs);
            try {
                scan.get(6000, TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                // Quello che si è trovato basta.
            }
            JSArray devices = new JSArray();
            for (Map.Entry<String, String> entry : found.entrySet()) {
                JSObject device = new JSObject();
                device.put("ip", entry.getKey());
                device.put("location", entry.getValue().isEmpty() ? JSONObject.NULL : entry.getValue());
                devices.put(device);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        String host = call.getString("host", "");
        if (host == null || !host.matches("[a-z0-9.-]+\\.pcloud\\.com")) {
            call.reject("Server non valido.");
            return;
        }
        pool.execute(() -> {
            try {
                for (InetAddress address : InetAddress.getAllByName(host)) {
                    if (address instanceof Inet4Address) {
                        JSObject result = new JSObject();
                        result.put("ip", address.getHostAddress());
                        call.resolve(result);
                        return;
                    }
                }
                call.reject("Il server di pCloud non ha un indirizzo IPv4.");
            } catch (Exception error) {
                call.reject("Server di pCloud non trovato.");
            }
        });
    }

    /** M-SEARCH: chi risponde come MediaRenderer, con l'indirizzo della sua descrizione. */
    private void ssdp(Map<String, String> found, int timeoutMs) {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        // Senza questo molti telefoni scartano le risposte multicast per risparmiare batteria.
        WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("musicx-ssdp") : null;
        try {
            if (lock != null) {
                lock.setReferenceCounted(false);
                lock.acquire();
            }
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setSoTimeout(250);
                byte[] search = SSDP_SEARCH.getBytes(StandardCharsets.UTF_8);
                DatagramPacket packet = new DatagramPacket(search, search.length, InetAddress.getByName("239.255.255.250"), 1900);
                socket.send(packet);
                long start = System.currentTimeMillis();
                boolean resent = false;
                byte[] buffer = new byte[4096];
                while (System.currentTimeMillis() - start < timeoutMs) {
                    // Una seconda volta: l'UDP si perde facilmente.
                    if (!resent && System.currentTimeMillis() - start > 400) {
                        socket.send(packet);
                        resent = true;
                    }
                    DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(reply);
                    } catch (SocketTimeoutException timeout) {
                        continue;
                    }
                    String ip = reply.getAddress().getHostAddress();
                    String location = header(new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8), "location");
                    if (location != null && isPrivate(ip)) found.put(ip, location);
                }
            }
        } catch (Exception ignored) {
            // Niente SSDP: resta la ricerca con l'API Yamaha.
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    /** Chiede l'API Yamaha a ogni indirizzo della /24 del Wi-Fi: trova le MusicCast anche se SSDP non passa. */
    private void scanYamaha(Map<String, String> found, int timeoutMs) {
        ExecutorService scan = Executors.newFixedThreadPool(96);
        List<Future<?>> jobs = new ArrayList<>();
        for (String prefix : ownPrefixes()) {
            for (int host = 1; host < 255; host++) {
                String ip = prefix + "." + host;
                jobs.add(scan.submit(() -> {
                    if (isYamaha(ip, timeoutMs)) found.putIfAbsent(ip, "");
                }));
            }
        }
        for (Future<?> job : jobs) {
            try {
                job.get();
            } catch (Exception ignored) {
                // Indirizzo che non risponde.
            }
        }
        scan.shutdown();
    }

    private static boolean isYamaha(String ip, int timeoutMs) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://" + ip + "/YamahaExtendedControl/v1/system/getDeviceInfo").openConnection();
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setRequestProperty("Connection", "close");
            if (connection.getResponseCode() != 200) return false;
            return read(connection.getInputStream()).replace(" ", "").contains("\"response_code\":0");
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** I primi tre numeri degli indirizzi del Wi-Fi (o Ethernet), es. "192.168.1". */
    private static Set<String> ownPrefixes() {
        Set<String> prefixes = new LinkedHashSet<>();
        try {
            for (NetworkInterface net : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                String name = net.getName();
                if (!net.isUp() || net.isLoopback() || !(name.startsWith("wlan") || name.startsWith("eth"))) continue;
                for (InetAddress address : Collections.list(net.getInetAddresses())) {
                    String ip = address.getHostAddress();
                    if (address instanceof Inet4Address && isPrivate(ip)) prefixes.add(ip.substring(0, ip.lastIndexOf('.')));
                }
            }
        } catch (Exception ignored) {
            // Nessuna rete: niente da cercare.
        }
        return prefixes;
    }

    /** 10.x, 172.16–31.x, 192.168.x: solo la rete di casa. */
    private static boolean isPrivate(String ip) {
        String[] parts = ip.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
        } catch (NumberFormatException error) {
            return false;
        }
    }

    private static String header(String text, String name) {
        for (String line : text.split("\r?\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase(name)) return line.substring(colon + 1).trim();
        }
        return null;
    }

    private static String read(InputStream input) throws java.io.IOException {
        try (InputStream stream = input) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[2048];
            int count;
            while ((count = stream.read(buffer)) != -1 && out.size() < 65536) out.write(buffer, 0, count);
            return out.toString("UTF-8");
        }
    }
}
