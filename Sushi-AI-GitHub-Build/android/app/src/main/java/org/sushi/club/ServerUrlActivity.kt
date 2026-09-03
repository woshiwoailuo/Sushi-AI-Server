package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class ServerUrlActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server)
        val url = findViewById<EditText>(R.id.url)
        val status = findViewById<TextView>(R.id.connectionStatus)
        val test = findViewById<Button>(R.id.testConnection)
        val save = findViewById<Button>(R.id.save)
        url.setText(Session.baseUrl())
        findViewById<Button>(R.id.backServer).setOnClickListener { finish() }
        test.setOnClickListener {
            val candidate = try { Api.normalizeServerUrl(url.text.toString()) }
                catch (e: ApiException) { status.text = e.message; return@setOnClickListener }
            test.isEnabled = false
            status.text = "正在检测连接…"
            lifecycleScope.launch {
                try { status.text = Api.probeServer(candidate) }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { status.text = e.message ?: "连接失败" }
                finally { test.isEnabled = true }
            }
        }
        save.setOnClickListener {
            val candidate = try { Api.normalizeServerUrl(url.text.toString()) }
                catch (e: ApiException) { status.text = e.message; return@setOnClickListener }
            if (candidate == Session.baseUrl()) { finish(); return@setOnClickListener }
            save.isEnabled = false
            // A login belongs to its original server. Never send its token to the new host.
            Session.clear()
            Session.clearUpdate()
            Session.setBaseUrl(candidate)
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush()
                if (!isFinishing && !isDestroyed) {
                    startActivity(Intent(this, LoginActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    finish()
                }
            }
        }
    }
}
