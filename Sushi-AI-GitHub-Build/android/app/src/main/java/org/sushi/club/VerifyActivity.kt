package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class VerifyActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_verify)
        val email = intent.getStringExtra("email").orEmpty()
        val code = findViewById<EditText>(R.id.code)
        val error = findViewById<TextView>(R.id.error)
        val submit = findViewById<TextView>(R.id.submit)
        val resend = findViewById<TextView>(R.id.resend)
        submit.isEnabled = true
        submit.isClickable = true
        submit.isFocusable = true
        resend.isEnabled = true
        resend.isClickable = true
        resend.isFocusable = true
        findViewById<TextView>(R.id.hint).text = getString(R.string.verify_hint, email)
        submit.setOnClickListener {
            error.text = "登录中…"
            submit.isEnabled = false
            submit.isClickable = false
            lifecycleScope.launch {
                try {
                    val body = JSONObject().put("email", email).put("code", code.text.toString().trim())
                    val data = Api.post("/api/auth/verify", body, auth = false)
                    Session.setToken(data.getString("token"))
                    Session.persistUser(data.getJSONObject("user"))
                    startActivity(Intent(this@VerifyActivity, MainActivity::class.java).putExtra("open_gen", true))
                    finishAffinity()
                } catch (e: Exception) {
                    error.text = e.message.orEmpty().ifBlank { e.toString() }
                } finally {
                    submit.isEnabled = true
                    submit.isClickable = true
                }
            }
        }
        resend.setOnClickListener {
            error.text = "登录中…"
            resend.isEnabled = false
            resend.isClickable = false
            lifecycleScope.launch {
                try {
                    Api.post("/api/auth/resend", JSONObject().put("email", email), auth = false)
                    error.text = getString(R.string.resent)
                } catch (e: Exception) {
                    error.text = e.message.orEmpty().ifBlank { e.toString() }
                } finally {
                    resend.isEnabled = true
                    resend.isClickable = true
                }
            }
        }
    }
}
