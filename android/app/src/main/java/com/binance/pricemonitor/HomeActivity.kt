package com.binance.pricemonitor

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.net.Uri
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
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
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
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

private const val PREFS_NAME = "amaze_monitor_prefs"
private const val PREFS_SYMBOLS_KEY = "binance_symbols"
private const val PREFS_SYMBOLS_DISPLAY_KEY = "binance_symbols_display"
private const val PREFS_FONT_SIZE = "floating_font_size"
private const val PREFS_OPACITY = "floating_opacity"
private const val PREFS_SHOW_SYMBOL = "floating_show_symbol"
private const val PREFS_ITEMS_PER_PAGE = "floating_items_per_page"

class HomeActivity : ComponentActivity(), FloatingWindowService.TickerUpdateListener {

    private val symbolsState = mutableStateListOf<String>()
    private val priceMap = mutableStateMapOf<String, Double>()
    private val changeMap = mutableStateMapOf<String, Double>()
    private var floatingActive = mutableStateOf(false)
    private val gson = Gson()
    private var prefsListener: android.content.SharedPreferences.OnSharedPreferenceChangeListener? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.AppTheme_NoActionBar)

        symbolsState.addAll(loadSymbols())

        // Start data service with symbols to ensure ticker feed is live on native home
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_START_DATA
            putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(expandSymbolsForService(symbolsState)))
            putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST_DISPLAY, ArrayList(symbolsState))
        }
        startService(intent)
        applyFloatingConfig()

        setContent {
            HomeScreen()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshSymbolsFromPrefs()
        FloatingWindowService.setTickerListener(this)
        registerPrefsListener()
        val dataIntent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_START_DATA
            putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(expandSymbolsForService(symbolsState)))
            putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST_DISPLAY, ArrayList(symbolsState))
        }
        startService(dataIntent)
        applyFloatingConfig()
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_REQUEST_UPDATE
        }
        startService(intent)
    }

    override fun onTickerUpdate(symbol: String, price: Double, changePercent: Double) {
        runOnUiThread {
            priceMap[symbol] = price
            changeMap[symbol] = changePercent
        }
    }

    private fun addSymbol(text: String) {
        val normalized = normalizeSymbol(text)
        if (normalized.isBlank()) return
        val sym = if (isCompositeSymbol(normalized)) {
            normalizeCompositeSymbol(normalized)
        } else {
            val base = if (normalized.endsWith(".P")) normalized.dropLast(2) else normalized
            val spot = if (base.endsWith("USDT")) base else "${base}USDT"
            if (normalized.endsWith(".P")) "${spot}.P" else spot
        }
        if (!symbolsState.contains(sym)) {
            symbolsState.add(sym)
            persistSymbols()
            // Update service
            val intent = Intent(this, FloatingWindowService::class.java).apply {
                action = FloatingWindowService.ACTION_SET_SYMBOLS
                putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(expandSymbolsForService(symbolsState)))
                putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST_DISPLAY, ArrayList(symbolsState))
            }
            startService(intent)
            startService(Intent(this, FloatingWindowService::class.java).apply {
                action = FloatingWindowService.ACTION_REQUEST_UPDATE
            })
            val handler = android.os.Handler(android.os.Looper.getMainLooper())
            handler.postDelayed({
                startService(Intent(this, FloatingWindowService::class.java).apply {
                    action = FloatingWindowService.ACTION_REQUEST_UPDATE
                })
            }, 1500)
            handler.postDelayed({
                startService(Intent(this, FloatingWindowService::class.java).apply {
                    action = FloatingWindowService.ACTION_REQUEST_UPDATE
                })
            }, 3500)
        }
    }

    private fun toggleFloating() {
        val turningOn = !floatingActive.value
        if (turningOn && !ensureOverlayPermission()) {
            return
        }
        floatingActive.value = turningOn
        if (turningOn) {
            applyFloatingConfig()
        }
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = if (floatingActive.value) FloatingWindowService.ACTION_SHOW_WINDOW
                     else FloatingWindowService.ACTION_HIDE_WINDOW
        }
        startService(intent)
    }

    private fun openChart(symbol: String) {
        val intent = buildMainIntent().apply {
            putExtra("symbol", symbol)
        }
        startActivity(intent)
    }

    private fun openAlert(symbol: String) {
        val intent = buildMainIntent().apply {
            putExtra("symbol", symbol)
            putExtra("openAlert", true)
        }
        startActivity(intent)
    }

    private fun openSettings() {
        val intent = buildMainIntent().apply {
            putExtra("openSettings", true)
        }
        startActivity(intent)
    }

    private fun openEdit() {
        val intent = buildMainIntent().apply {
            putExtra("openEdit", true)
        }
        startActivity(intent)
    }

    private fun buildMainIntent(): Intent {
        return Intent(this, MainActivity::class.java).apply {
            putExtra("symbolsJson", gson.toJson(symbolsState.toList()))
        }
    }

    private fun loadSymbols(): List<String> {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val stored = prefs.getString(PREFS_SYMBOLS_DISPLAY_KEY, null)
            ?: prefs.getString(PREFS_SYMBOLS_KEY, null)
        if (!stored.isNullOrBlank()) {
            try {
                val type = object : TypeToken<List<String>>() {}.type
                val parsed: List<String>? = gson.fromJson(stored, type)
                if (!parsed.isNullOrEmpty()) {
                    return parsed
                }
            } catch (_: Exception) {}
        }
        return listOf("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "ZECUSDT")
    }

    private fun persistSymbols() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val list = symbolsState.toList()
        val editor = prefs.edit()
        editor.putString(PREFS_SYMBOLS_KEY, gson.toJson(list))
        editor.putString(PREFS_SYMBOLS_DISPLAY_KEY, gson.toJson(list))
        editor.commit()
    }

    private fun ensureOverlayPermission(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M) {
            return true
        }
        if (Settings.canDrawOverlays(this)) {
            return true
        }
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
        return false
    }

    private fun refreshSymbolsFromPrefs() {
        val latest = loadSymbols()
        if (symbolsState.toList() != latest) {
            symbolsState.clear()
            symbolsState.addAll(latest)
            val intent = Intent(this, FloatingWindowService::class.java).apply {
                action = FloatingWindowService.ACTION_SET_SYMBOLS
                putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, ArrayList(expandSymbolsForService(symbolsState)))
                putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST_DISPLAY, ArrayList(symbolsState))
            }
            startService(intent)
            startService(Intent(this, FloatingWindowService::class.java).apply {
                action = FloatingWindowService.ACTION_REQUEST_UPDATE
            })
        }
    }

    private fun registerPrefsListener() {
        if (prefsListener != null) return
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        prefsListener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == PREFS_SYMBOLS_DISPLAY_KEY || key == PREFS_SYMBOLS_KEY) {
                refreshSymbolsFromPrefs()
            }
        }
        prefs.registerOnSharedPreferenceChangeListener(prefsListener)
    }

    override fun onPause() {
        super.onPause()
        prefsListener?.let { listener ->
            val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            prefs.unregisterOnSharedPreferenceChangeListener(listener)
        }
        prefsListener = null
    }

    private fun applyFloatingConfig() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val fontSize = prefs.getFloat(PREFS_FONT_SIZE, 10f)
        val opacity = prefs.getFloat(PREFS_OPACITY, 0.5f)
        val showSymbol = prefs.getBoolean(PREFS_SHOW_SYMBOL, false)
        val itemsPerPage = prefs.getInt(PREFS_ITEMS_PER_PAGE, 1)
        val intent = Intent(this, FloatingWindowService::class.java).apply {
            action = FloatingWindowService.ACTION_CONFIG
            putExtra(FloatingWindowService.EXTRA_FONT_SIZE, fontSize)
            putExtra(FloatingWindowService.EXTRA_OPACITY, opacity)
            putExtra(FloatingWindowService.EXTRA_SHOW_SYMBOL, showSymbol)
            putExtra(FloatingWindowService.EXTRA_ITEMS_PER_PAGE, itemsPerPage)
        }
        startService(intent)
    }

    @Composable
    fun HomeScreen() {
        var inputText by remember { mutableStateOf("") }
        val suggestions = remember(inputText) { buildSuggestions(inputText) }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(BgPrimary)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header
                GlassHeader(
                    onEditClick = { openEdit() },
                    onSettingsClick = { openSettings() }
                )

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
                if (suggestions.isNotEmpty()) {
                    SuggestionList(
                        suggestions = suggestions,
                        onPick = {
                            addSymbol(it)
                            inputText = ""
                        }
                    )
                }

                // Symbol List
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                    contentPadding = PaddingValues(bottom = 100.dp)
                ) {
                    itemsIndexed(symbolsState) { _, symbol ->
                        val composite = if (isCompositeSymbol(symbol)) computeCompositeTicker(symbol) else null
                        TickerCard(
                            symbol = symbol,
                            price = composite?.first ?: priceMap[symbol],
                            change = composite?.second ?: changeMap[symbol],
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
    fun GlassHeader(onEditClick: () -> Unit, onSettingsClick: () -> Unit) {
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
                IconButton(
                    onClick = onEditClick,
                    modifier = Modifier
                        .size(38.dp)
                        .background(BgSecondary, RoundedCornerShape(10.dp))
                ) {
                    Icon(
                        imageVector = Icons.Filled.Edit,
                        contentDescription = "排序",
                        tint = TextPrimary
                    )
                }
                Spacer(Modifier.width(8.dp))
                // Settings button
                IconButton(
                    onClick = onSettingsClick,
                    modifier = Modifier
                        .size(38.dp)
                        .background(BgSecondary, RoundedCornerShape(10.dp))
                ) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "设置",
                        tint = TextPrimary
                    )
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
    fun SuggestionList(
        suggestions: List<String>,
        onPick: (String) -> Unit
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = RoundedCornerShape(10.dp),
            color = BgCard,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor)
        ) {
            Column {
                suggestions.forEachIndexed { idx, sug ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(sug) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = sug,
                            color = TextPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = if (sug.endsWith(".P")) "永续" else "现货",
                            color = TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                    if (idx < suggestions.size - 1) {
                        Divider(color = BorderColor, thickness = 1.dp)
                    }
                }
            }
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
                    Icon(
                        imageVector = Icons.Filled.Notifications,
                        contentDescription = "预警",
                        tint = TextSecondary
                    )
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
                        Text("关闭悬浮窗", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                } else {
                    GradientButton(
                        text = "开启悬浮窗",
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
                    Text("设置")
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

    private fun normalizeSymbol(input: String): String {
        return input.trim().uppercase().replace("\\s+".toRegex(), "")
    }

    private fun buildSuggestions(input: String): List<String> {
        val normalized = normalizeSymbol(input)
        if (normalized.isBlank()) return emptyList()
        if (isCompositeSymbol(normalized)) {
            return listOf(normalizeCompositeSymbol(normalized))
        }
        val base = if (normalized.endsWith(".P")) normalized.dropLast(2) else normalized
        val spot = if (base.endsWith("USDT")) base else "${base}USDT"
        return listOf(spot, "${spot}.P").distinct()
    }

    private fun isCompositeSymbol(value: String): Boolean {
        if (!value.contains("/")) return false
        val parts = value.split("/")
        return parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()
    }

    private fun normalizeCompositeSymbol(value: String): String {
        val normalized = normalizeSymbol(value)
        val parts = normalized.split("/")
        if (parts.size != 2) return normalized
        return "${parts[0]}/${parts[1]}"
    }

    private fun stripPerpSuffix(token: String): String {
        return if (token.endsWith(".P")) token.dropLast(2) else token
    }

    private fun tokenToSpotSymbol(token: String): String {
        return if (token.endsWith("USDT")) token else "${token}USDT"
    }

    private fun expandSymbolsForService(displaySymbols: List<String>): List<String> {
        val out = linkedSetOf<String>()
        displaySymbols.forEach { raw ->
            val normalized = normalizeSymbol(raw)
            if (normalized.isBlank()) return@forEach
            if (isCompositeSymbol(normalized)) {
                val parts = normalizeCompositeSymbol(normalized).split("/")
                if (parts.size != 2) return@forEach
                val baseToken = stripPerpSuffix(parts[0])
                val quoteToken = stripPerpSuffix(parts[1])
                val baseSpot = tokenToSpotSymbol(baseToken)
                val quoteSpot = tokenToSpotSymbol(quoteToken)
                out.add(baseSpot)
                out.add("${baseSpot}.P")
                out.add(quoteSpot)
                out.add("${quoteSpot}.P")
            } else {
                out.add(normalized)
            }
        }
        return out.toList()
    }

    private fun pickLegPrice(spotSymbol: String, perpSymbol: String): Pair<Double, Double?>? {
        val spotPrice = priceMap[spotSymbol]
        if (spotPrice != null) return Pair(spotPrice, changeMap[spotSymbol])
        val perpPrice = priceMap[perpSymbol]
        if (perpPrice != null) return Pair(perpPrice, changeMap[perpSymbol])
        return null
    }

    private fun computeCompositeTicker(symbol: String): Pair<Double?, Double?>? {
        if (!isCompositeSymbol(symbol)) return null
        val parts = normalizeCompositeSymbol(symbol).split("/")
        if (parts.size != 2) return null
        val baseToken = stripPerpSuffix(parts[0])
        val quoteToken = stripPerpSuffix(parts[1])
        val baseSpot = tokenToSpotSymbol(baseToken)
        val quoteSpot = tokenToSpotSymbol(quoteToken)
        val basePick = pickLegPrice(baseSpot, "${baseSpot}.P")
        val quotePick = pickLegPrice(quoteSpot, "${quoteSpot}.P")
        val basePrice = basePick?.first
        val quotePrice = quotePick?.first
        if (basePrice == null || quotePrice == null || quotePrice == 0.0) return Pair(null, null)
        val price = basePrice / quotePrice

        val baseChange = basePick.second
        val quoteChange = quotePick.second
        val change = if (baseChange != null && quoteChange != null) {
            val ratio = (1 + baseChange / 100.0) / (1 + quoteChange / 100.0) - 1
            ratio * 100.0
        } else {
            null
        }
        return Pair(price, change)
    }
}
