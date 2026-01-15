package com.binance.pricemonitor;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class HomeActivity extends AppCompatActivity implements FloatingWindowService.TickerUpdateListener {

    private RecyclerView recyclerView;
    private SymbolAdapter adapter;
    private List<String> symbols = new ArrayList<>();
    // Keep track of latest prices
    private Map<String, Double> priceMap = new ConcurrentHashMap<>();
    private Map<String, Double> changeMap = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);

        recyclerView = findViewById(R.id.recyclerView);
        recyclerView.setLayoutManager(new LinearLayoutManager(this));

        // Default symbols - in a real app these might come from storage or the JS side originally
        // For now, we seed some defaults or wait for Service to sync.
        // Actually, we can just use a default list to start.
        symbols.add("BTCUSDT");
        symbols.add("ETHUSDT");
        symbols.add("BNBUSDT");
        symbols.add("SOLUSDT");
        symbols.add("DOGEUSDT");

        adapter = new SymbolAdapter(symbols);
        recyclerView.setAdapter(adapter);

        // Start the service if not running, to ensure we get data
        startService(new Intent(this, FloatingWindowService.class));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Register as listener
        FloatingWindowService.setTickerListener(this);
        // Request immediate data replay
        Intent intent = new Intent(this, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_REQUEST_UPDATE);
        startService(intent);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // We *could* unregister, but since it's a static single listener,
        // we might steal it from the widget.
        // Actually FloatingWindowService logic says: private static TickerUpdateListener tickerListener;
        // So only one listener at a time? That might be a limitation if we want both Widget and Home to update.
        // Let's check FloatingWindowService.
        // The service updates UI (Widget) independently of the listener.
        // The listener is FOR external plugins/activities.
        // So it is safe for us to be the listener.
    }

    @Override
    public void onTickerUpdate(String symbol, double price, double changePercent) {
        priceMap.put(symbol, price);
        changeMap.put(symbol, changePercent);
        
        runOnUiThread(() -> {
            int index = -1;
            for (int i = 0; i < symbols.size(); i++) {
                if (symbols.get(i).equalsIgnoreCase(symbol)) {
                    index = i;
                    break;
                }
            }
            if (index != -1) {
                adapter.notifyItemChanged(index, "PAYLOAD_PRICE"); 
            } else {
                 // New symbol discovered? Add it
                 symbols.add(symbol);
                 adapter.notifyItemInserted(symbols.size() - 1);
            }
        });
    }

    private class SymbolAdapter extends RecyclerView.Adapter<SymbolAdapter.ViewHolder> {
        private List<String> data;

        public SymbolAdapter(List<String> data) {
            this.data = data;
        }

        @NonNull
        @Override
        public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_symbol, parent, false);
            return new ViewHolder(v);
        }

        @Override
        public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
            String symbol = data.get(position);
            Double price = priceMap.get(symbol);
            Double change = changeMap.get(symbol);

            holder.symbolTv.setText(symbol);
            
            if (price != null) {
                holder.priceTv.setText(formatPrice(price));
            } else {
                holder.priceTv.setText("--");
            }

            if (change != null) {
                holder.changeTv.setText(String.format("%.2f%%", change));
                int color = change >= 0 ? 0xFF00C853 : 0xFFFF4444; // Green / Red
                holder.changeTv.setBackgroundColor(color);
            } else {
                holder.changeTv.setText("--");
                holder.changeTv.setBackgroundColor(Color.GRAY);
            }

            holder.itemView.setOnClickListener(v -> {
                Intent intent = new Intent(HomeActivity.this, MainActivity.class);
                intent.putExtra("symbol", symbol);
                startActivity(intent);
            });
        }
        
        @Override
        public void onBindViewHolder(@NonNull ViewHolder holder, int position, @NonNull List<Object> payloads) {
            if (!payloads.isEmpty()) {
                 // Efficient partial update
                 String symbol = data.get(position);
                 Double price = priceMap.get(symbol);
                 Double change = changeMap.get(symbol);
                 
                 if (price != null) holder.priceTv.setText(formatPrice(price));
                 if (change != null) {
                     holder.changeTv.setText(String.format("%.2f%%", change));
                     int color = change >= 0 ? 0xFF00C853 : 0xFFFF4444;
                     holder.changeTv.setBackgroundColor(color);
                 }
            } else {
                super.onBindViewHolder(holder, position, payloads);
            }
        }

        @Override
        public int getItemCount() {
            return data.size();
        }

        class ViewHolder extends RecyclerView.ViewHolder {
            TextView symbolTv, priceTv, changeTv;

            public ViewHolder(@NonNull View itemView) {
                super(itemView);
                symbolTv = itemView.findViewById(R.id.symbol);
                priceTv = itemView.findViewById(R.id.price);
                changeTv = itemView.findViewById(R.id.change);
            }
        }
    }
    
    private String formatPrice(double price) {
        if (price >= 1000) return String.format("%.2f", price);
        if (price >= 1) return String.format("%.4f", price);
        return String.format("%.6f", price);
    }
}
