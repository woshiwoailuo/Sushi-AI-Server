package org.sushi.club

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

class GenFragment : Fragment() {
    private var loaded = false
    private var opening = false
    private var wrapKey: String? = null
    private var attempt = 0
    private var ticketJob: Job? = null
    private var loadedBase = ""
    private var deadline = 0L
    private var checking = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        inflater.inflate(R.layout.fragment_gen, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        configure(view.findViewById(R.id.webview))
        view.findViewById<Button>(R.id.retryGate).setOnClickListener { openWorkshop(force = true) }
        view.findViewById<Button>(R.id.serverGate).setOnClickListener {
            startActivity(Intent(requireContext(), ServerUrlActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        if (loaded && loadedBase == Session.baseUrl()) {
            view?.findViewById<WebView>(R.id.webview)?.let { injectPendingPrompt(it) }
        } else {
            openWorkshop(force = false)
        }
    }

    private fun showGate(title: String, detail: String, busy: Boolean) {
        val root = view ?: return
        root.findViewById<LinearLayout>(R.id.gate).visibility = View.VISIBLE
        root.findViewById<TextView>(R.id.gateTitle).text = title
        root.findViewById<TextView>(R.id.gateBody).text = detail
        root.findViewById<Button>(R.id.retryGate).apply {
            isEnabled = !busy
            visibility = if (busy) View.GONE else View.VISIBLE
        }
    }

    private fun fail(message: String) {
        loaded = false
        opening = false
        checking = false
        wrapKey = null
        showGate("工坊未能打开", message, false)
    }

    private fun openWorkshop(force: Boolean) {
        val root = view ?: return
        if (opening && !force) return
        if (loaded && loadedBase == Session.baseUrl() && !force) return
        ticketJob?.cancel()
        val current = ++attempt
        loaded = false
        opening = true
        checking = false
        wrapKey = null
        val web = root.findViewById<WebView>(R.id.webview)
        web.stopLoading()
        showGate(getString(R.string.opening_workshop), "正在恢复登录和创作页面…", true)
        ticketJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                val wrap = withTimeout(35_000) { Api.post("/api/workshop/ticket") }
                if (current != attempt) return@launch
                wrapKey = wrap.getString("key")
                loadedBase = Session.baseUrl()
                deadline = SystemClock.elapsedRealtime() + 45_000
                val ticket = URLEncoder.encode(wrap.getString("ticket"), "UTF-8")
                val headers = if (loadedBase.contains("pinggy", ignoreCase = true))
                    mapOf("X-Pinggy-No-Screen" to "true") else emptyMap()
                web.loadUrl("$loadedBase/workshop?k=$ticket", headers)
                web.postDelayed({
                    if (current == attempt && opening && !loaded) fail("页面加载超时，请检查服务器地址或网络后重试。")
                }, 45_000)
            } catch (e: CancellationException) {
                if (current == attempt && isAdded) fail("连接超时，请检查网络后重试。")
                throw e
            } catch (e: Exception) {
                if (current == attempt) fail(e.message ?: getString(R.string.temp_offline))
            }
        }
    }

    private fun sameOrigin(url: String?): Boolean = try {
        val actual = Uri.parse(url ?: "")
        val expected = Uri.parse(loadedBase.ifBlank { Session.baseUrl() })
        fun port(uri: Uri): Int = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
        actual.scheme == expected.scheme && actual.host == expected.host && port(actual) == port(expected)
    } catch (_: Exception) { false }

    private fun isWorkshop(web: WebView): Boolean =
        sameOrigin(web.url) && (Uri.parse(web.url).path ?: "").trimEnd('/') == "/workshop"

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(web: WebView) {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = WebSettings.getDefaultUserAgent(requireContext()) + " SushiClub/" + BuildConfig.VERSION_NAME
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                if (sameOrigin(uri.toString()) && (uri.path ?: "").trimEnd('/') == "/workshop") return false
                if (request.hasGesture() && uri.scheme in listOf("https", "http", "mailto")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    catch (_: Exception) { Toast.makeText(requireContext(), "未找到可打开链接的应用", Toast.LENGTH_SHORT).show() }
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && opening) fail("无法连接工坊，请检查网络或服务器地址后重试。")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame && opening) {
                    fail(if (response.statusCode == 401) "进入凭证已过期，请点击重试。" else "服务器返回 ${response.statusCode}，请稍后重试。")
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!opening || !isWorkshop(view)) return
                injectUnlock(view)
                if (!checking) {
                    checking = true
                    checkReady(view, attempt)
                }
            }
        }
    }

    private fun checkReady(web: WebView, current: Int) {
        if (current != attempt || !opening || view == null || !isWorkshop(web)) return
        web.evaluateJavascript("JSON.stringify({ready:!!window.__sushiReady,error:window.__sushiLoadError||''})") { raw ->
            if (current != attempt || !opening || view == null) return@evaluateJavascript
            val state = try { JSONObject(JSONArray("[$raw]").getString(0)) } catch (_: Exception) { JSONObject() }
            when {
                state.optBoolean("ready") -> {
                    loaded = true; opening = false; checking = false; wrapKey = null
                    view?.findViewById<LinearLayout>(R.id.gate)?.visibility = View.GONE
                    injectPrefs(web)
                    injectPendingPrompt(web)
                    CookieManager.getInstance().flush()
                }
                state.optString("error").isNotBlank() -> fail(state.optString("error"))
                SystemClock.elapsedRealtime() >= deadline -> fail("打开工坊超时，请点击重试。")
                else -> web.postDelayed({ injectUnlock(web); checkReady(web, current) }, 500)
            }
        }
    }

    private fun injectUnlock(web: WebView) {
        if (!opening || !isWorkshop(web)) return
        val key = wrapKey ?: return
        web.evaluateJavascript("window.__sushiUnlock && window.__sushiUnlock(${JSONObject.quote(key)})", null)
    }

    private fun injectPrefs(web: WebView) {
        if (!loaded || !isWorkshop(web)) return
        val user = Session.user ?: return
        val email = JSONObject.quote(user.optString("email"))
        val json = JSONObject.quote(user.toString())
        web.evaluateJavascript("""
            (function(){try{
                localStorage.setItem('sushi_email', $email);
                localStorage.setItem('email', $email);
                localStorage.setItem('sushi_user', $json);
            }catch(e){}})();
        """.trimIndent(), null)
    }

    private fun injectPendingPrompt(web: WebView) {
        if (!loaded || !isWorkshop(web)) return
        val prompt = Session.pendingPrompt()
        if (prompt.isBlank()) return
        val arg = JSONObject.quote(prompt)
        web.evaluateJavascript("""
            (function(){
                var el=document.getElementById('角色描述');
                if(!el) return 'wait';
                el.value=$arg;
                el.dispatchEvent(new Event('input',{bubbles:true}));
                try{localStorage.setItem('角色生成器_上次描述',$arg);}catch(e){}
                return 'ok';
            })();
        """.trimIndent()) { result ->
            if (result == "\"ok\"" && Session.pendingPrompt() == prompt) Session.consumePendingPrompt()
        }
    }

    override fun onDestroyView() {
        attempt += 1
        ticketJob?.cancel()
        loaded = false; opening = false; checking = false; wrapKey = null
        view?.findViewById<WebView>(R.id.webview)?.apply {
            stopLoading()
            webChromeClient = null
            destroy()
        }
        super.onDestroyView()
    }
}
