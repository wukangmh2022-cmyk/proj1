package com.binance.pricemonitor;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
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
    private Map<String, Double> priceMap = new ConcurrentHashMap<>();
    private Map<String, Double> changeMap = new ConcurrentHashMap<>();
    private EditText inputSymbol;
    private Button btnFloatingToggle;
    private boolean floatingActive = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);

        recyclerView = findViewById(R.id.recyclerView);
        recyclerView.setLayoutManager(new LinearLayoutManager(this));
        inputSymbol = findViewById(R.id.inputSymbol);
        btnFloatingToggle = findViewById(R.id.btnFloatingToggle);

        // Default symbols
        symbols.add("BTCUSDT");
        symbols.add("ETHUSDT");
        symbols.add("BNBUSDT");
        symbols.add("SOLUSDT");
        symbols.add("DOGEUSDT");

        adapter = new SymbolAdapter(symbols);
        recyclerView.setAdapter(adapter);

        // Start data service
        Intent intent = new Intent(this, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_SET_SYMBOLS);
        intent.putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, new ArrayList<>(symbols));
        startService(intent);

        // Settings button -> open WebView React App
        findViewById(R.id.btnSettings).setOnClickListener(v -> {
            Intent settingsIntent = new Intent(HomeActivity.this, MainActivity.class);
            startActivity(settingsIntent);
        });

        // Open settings button in floating controls
        findViewById(R.id.btnOpenSettings).setOnClickListener(v -> {
            Intent settingsIntent = new Intent(HomeActivity.this, MainActivity.class);
            startActivity(settingsIntent);
        });

        // Edit button (placeholder - could toggle edit mode)
        findViewById(R.id.btnEdit).setOnClickListener(v -> {
            // For now, just open settings
            Intent settingsIntent = new Intent(HomeActivity.this, MainActivity.class);
            startActivity(settingsIntent);
        });

        // Add symbol
        findViewById(R.id.btnAdd).setOnClickListener(v -> addSymbol());
        inputSymbol.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                addSymbol();
                return true;
            }
            return false;
        });

        // Floating window toggle
        btnFloatingToggle.setOnClickListener(v -> toggleFloatingWindow());
    }

    private void addSymbol() {
        String text = inputSymbol.getText().toString().trim().toUpperCase();
        if (text.isEmpty()) return;
        
        // Normalize: add USDT if needed
        String sym = text.contains("USDT") ? text : text + "USDT";
        
        if (!symbols.contains(sym)) {
            symbols.add(sym);
            adapter.notifyItemInserted(symbols.size() - 1);
            
            // Update service
            Intent intent = new Intent(this, FloatingWindowService.class);
            intent.setAction(FloatingWindowService.ACTION_SET_SYMBOLS);
            intent.putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, new ArrayList<>(symbols));
            startService(intent);
        }
        
        inputSymbol.setText("");
    }

    private void toggleFloatingWindow() {
        floatingActive = !floatingActive;
        Intent intent = new Intent(this, FloatingWindowService.class);
        if (floatingActive) {
            intent.setAction(FloatingWindowService.ACTION_SHOW_WINDOW);
            btnFloatingToggle.setText("✕ 关闭悬浮窗");
            btnFloatingToggle.setBackgroundResource(R.drawable.btn_danger);
        } else {
            intent.setAction(FloatingWindowService.ACTION_HIDE_WINDOW);
            btnFloatingToggle.setText("🔲 开启悬浮窗");
            btnFloatingToggle.setBackgroundResource(R.drawable.btn_primary);
        }
        startService(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        FloatingWindowService.setTickerListener(this);
        Intent intent = new Intent(this, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_REQUEST_UPDATE);
        startService(intent);
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
                symbols.add(symbol);
                adapter.notifyItemInserted(symbols.size() - 1);
            }
        });
    }

    private void openAlertConfig(String symbol) {
        // Open WebView with alert modal for this symbol
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("symbol", symbol);
        intent.putExtra("openAlert", true);
        startActivity(intent);
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
                holder.priceTv.setText("$" + formatPrice(price));
            } else {
                holder.priceTv.setText("--");
            }

            if (change != null) {
                String sign = change >= 0 ? "+" : "";
                holder.changeTv.setText(String.format("%s%.2f%%", sign, change));
                if (change >= 0) {
                    holder.changeTv.setTextColor(0xFF00d68f);
                    holder.changeTv.setBackgroundResource(R.drawable.change_badge_up);
                } else {
                    holder.changeTv.setTextColor(0xFFff4757);
                    holder.changeTv.setBackgroundResource(R.drawable.change_badge_down);
                }
            } else {
                holder.changeTv.setText("--");
                holder.changeTv.setTextColor(Color.GRAY);
                holder.changeTv.setBackgroundResource(R.drawable.change_badge_up);
            }

            // Click card -> open chart
            holder.cardContainer.setOnClickListener(v -> {
                Intent intent = new Intent(HomeActivity.this, MainActivity.class);
                intent.putExtra("symbol", symbol);
                startActivity(intent);
            });

            // Click alert button -> open alert config
            holder.btnAlert.setOnClickListener(v -> openAlertConfig(symbol));
        }
        
        @Override
        public void onBindViewHolder(@NonNull ViewHolder holder, int position, @NonNull List<Object> payloads) {
            if (!payloads.isEmpty()) {
                String symbol = data.get(position);
                Double price = priceMap.get(symbol);
                Double change = changeMap.get(symbol);
                 
                if (price != null) holder.priceTv.setText("$" + formatPrice(price));
                if (change != null) {
                    String sign = change >= 0 ? "+" : "";
                    holder.changeTv.setText(String.format("%s%.2f%%", sign, change));
                    if (change >= 0) {
                        holder.changeTv.setTextColor(0xFF00d68f);
                        holder.changeTv.setBackgroundResource(R.drawable.change_badge_up);
                    } else {
                        holder.changeTv.setTextColor(0xFFff4757);
                        holder.changeTv.setBackgroundResource(R.drawable.change_badge_down);
                    }
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
            View cardContainer;
            ImageButton btnAlert;

            public ViewHolder(@NonNull View itemView) {
                super(itemView);
                symbolTv = itemView.findViewById(R.id.symbol);
                priceTv = itemView.findViewById(R.id.price);
                changeTv = itemView.findViewById(R.id.change);
                cardContainer = itemView.findViewById(R.id.cardContainer);
                btnAlert = itemView.findViewById(R.id.btnAlert);
            }
        }
    }
    
    private String formatPrice(double price) {
        if (price >= 1000) return String.format("%,.2f", price);
        if (price >= 1) return String.format("%.4f", price);
        return String.format("%.6f", price);
    }
}
