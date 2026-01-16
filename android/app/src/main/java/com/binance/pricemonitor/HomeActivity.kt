package com.binance.pricemonitor

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DecimalFormat
import java.util.concurrent.ConcurrentHashMap

// Color palette matching WebView CSS
private val BgPrimary = Color(0xFF0D1117)
private val BgSecondary = Color(0xFF161B22)
private val BgCard = Color(0xFF1E232C)
private val TextPrimary = Color(0xFFF0F6FC)
private val TextSecondary = Color(0xFF8B949E)
private val AccentGreen = Color(0xFF00D68F)
private val AccentRed = Color(0xFFFF4757)
private val AccentGold = Color(0xFFFCD535)
private val AccentOrange = Color(0xFFFF9F43)
private val BorderColor = Color(0xFF2D333B)

class HomeActivity : ComponentActivity(), FloatingWindowService.TickerUpdateListener {

    private val symbolsState = mutableStateListOf("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT")
    private val priceMap = ConcurrentHashMap<String, Double>()
    private val changeMap = ConcurrentHashMap<String, Double>()
    private var updateTrigger = mutableStateOf(0)
    private var floatingActive = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.AppTheme_NoActionBar)

        // Start service with symbols
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_SET_SYMBOLS
            putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(symbolsState))
        }
        startService(intent)

        setContent {
            HomeScreen()
        }
    }

    override fun onResume() {
        super.onResume()
        FloatingWindowService.setTickerListener(this)
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_REQUEST_UPDATE
        }
        startService(intent)
    }

    override fun onTickerUpdate(symbol: String, price: Double, changePercent: Double) {
        priceMap[symbol] = price
        changeMap[symbol] = changePercent
        // Trigger recomposition
        updateTrigger.value++
    }

    private fun addSymbol(text: String) {
        val sym = if (text.contains("USDT")) text.uppercase() else "${text.uppercase()}USDT"
        if (!symbolsState.contains(sym)) {
            symbolsState.add(sym)
            // Update service
            val intent = Intent(this, FloatingWindowService::class.java).apply {
                action = FloatingWindowService.ACTION_SET_SYMBOLS
                putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(symbolsState))
            }
            startService(intent)
        }
    }

    private fun toggleFloating() {
        floatingActive.value = !floatingActive.value
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = if (floatingActive.value) FloatingWindowService.ACTION_SHOW_WINDOW 
                     else FloatingWindowService.ACTION_HIDE_WINDOW
        }
        startService(intent)
    }

    private fun openChart(symbol: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("symbol", symbol)
        }
        startActivity(intent)
    }

    private fun openAlert(symbol: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("symbol", symbol)
            putExtra("openAlert", true)
        }
        startActivity(intent)
    }

    private fun openSettings() {
        startActivity(Intent(this, MainActivity::class.java))
    }

    @Composable
    fun HomeScreen() {
        // Force recomposition when prices update
        val tick by updateTrigger
        var inputText by remember { mutableStateOf("") }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(BgPrimary)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header
                GlassHeader(onSettingsClick = { openSettings() })

                // Add Symbol Input
                AddSymbolRow(
                    value = inputText,
                    onValueChange = { inputText = it.uppercase() },
                    onAdd = { 
                        if (inputText.isNotBlank()) {
                            addSymbol(inputText)
                            inputText = ""
                        }
                    }
                )

                // Symbol List
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                    contentPadding = PaddingValues(bottom = 100.dp)
                ) {
                    itemsIndexed(symbolsState) { _, symbol ->
                        TickerCard(
                            symbol = symbol,
                            price = priceMap[symbol],
                            change = changeMap[symbol],
                            onCardClick = { openChart(symbol) },
                            onAlertClick = { openAlert(symbol) }
                        )
                    }
                }
            }

            // Floating Controls at bottom
            FloatingControls(
                isActive = floatingActive.value,
                onToggle = { toggleFloating() },
                onSettings = { openSettings() },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp)
            )
        }
    }

    @Composable
    fun GlassHeader(onSettingsClick: () -> Unit) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp),
            color = BgCard,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor)
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Gradient title
                Text(
                    text = "实时",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = AccentGold,
                    modifier = Modifier.weight(1f)
                )
                // Settings button
                IconButton(
                    onClick = onSettingsClick,
                    modifier = Modifier
                        .size(38.dp)
                        .background(BgSecondary, RoundedCornerShape(10.dp))
                ) {
                    Text("⚙", fontSize = 18.sp, color = TextPrimary)
                }
            }
        }
    }

    @Composable
    fun AddSymbolRow(
        value: String,
        onValueChange: (String) -> Unit,
        onAdd: () -> Unit
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("添加交易对 (如 BTC)", color = TextSecondary) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = AccentGold,
                    unfocusedBorderColor = BorderColor,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    cursorColor = AccentGold,
                    focusedContainerColor = BgSecondary,
                    unfocusedContainerColor = BgSecondary
                ),
                shape = RoundedCornerShape(8.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = { onAdd() })
            )
            Spacer(Modifier.width(8.dp))
            GradientButton(
                text = "添加",
                onClick = onAdd
            )
        }
    }

    @Composable
    fun TickerCard(
        symbol: String,
        price: Double?,
        change: Double?,
        onCardClick: () -> Unit,
        onAlertClick: () -> Unit
    ) {
        val isPositive = (change ?: 0.0) >= 0
        val badgeColor by animateColorAsState(
            if (isPositive) AccentGreen.copy(alpha = 0.15f) else AccentRed.copy(alpha = 0.15f),
            label = "badgeColor"
        )
        val textColor by animateColorAsState(
            if (isPositive) AccentGreen else AccentRed,
            label = "textColor"
        )

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 6.dp)
                .clickable { onCardClick() },
            shape = RoundedCornerShape(16.dp),
            color = BgCard,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor)
        ) {
            Box {
                Column(modifier = Modifier.padding(12.dp)) {
                    // Symbol
                    Text(
                        text = symbol,
                        color = TextSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(Modifier.height(6.dp))
                    // Price row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (price != null) "$${formatPrice(price)}" else "--",
                            color = TextPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.weight(1f)
                        )
                        // Change badge
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = badgeColor
                        ) {
                            Text(
                                text = if (change != null) {
                                    val sign = if (change >= 0) "+" else ""
                                    "$sign${String.format("%.2f", change)}%"
                                } else "--",
                                color = textColor,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
                // Alert bell button
                IconButton(
                    onClick = onAlertClick,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(36.dp)
                ) {
                    Text("🔔", fontSize = 16.sp)
                }
            }
        }
    }

    @Composable
    fun FloatingControls(
        isActive: Boolean,
        onToggle: () -> Unit,
        onSettings: () -> Unit,
        modifier: Modifier = Modifier
    ) {
        Surface(
            modifier = modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            color = BgCard,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor)
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (isActive) {
                    Button(
                        onClick = onToggle,
                        modifier = Modifier.weight(1f).height(44.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentRed),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("✕ 关闭悬浮窗", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                } else {
                    GradientButton(
                        text = "🔲 开启悬浮窗",
                        onClick = onToggle,
                        modifier = Modifier.weight(1f).height(44.dp)
                    )
                }
                OutlinedButton(
                    onClick = onSettings,
                    modifier = Modifier.weight(1f).height(44.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextPrimary),
                    border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor)
                ) {
                    Text("⚙ 设置")
                }
            }
        }
    }

    @Composable
    fun GradientButton(
        text: String,
        onClick: () -> Unit,
        modifier: Modifier = Modifier
    ) {
        Box(
            modifier = modifier
                .height(48.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(
                    Brush.linearGradient(listOf(AccentGold, AccentOrange))
                )
                .clickable { onClick() },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = text,
                color = Color.Black,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp)
            )
        }
    }

    private fun formatPrice(price: Double): String {
        return when {
            price >= 1000 -> DecimalFormat("#,##0.00").format(price)
            price >= 1 -> String.format("%.4f", price)
            else -> String.format("%.6f", price)
        }
    }
}
