package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_login)
        val email = findViewById<EditText>(R.id.email)
        val password = findViewById<EditText>(R.id.password)
        val error = findViewById<TextView>(R.id.error)
        val submit = findViewById<TextView>(R.id.submit)
        submit.isEnabled = true
        submit.isClickable = true
        submit.isFocusable = true
        val doLogin = {
            error.text = "登录中…"
            submit.isEnabled = false
            submit.isClickable = false
            lifecycleScope.launch {
                try {
                    val body = JSONObject()
                        .put("email", email.text.toString())
                        .put("password", password.text.toString())
                    val data = Api.post("/api/auth/login", body, auth = false)
                    Session.setToken(data.getString("token"))
                    Session.persistUser(data.getJSONObject("user"))
                    startActivity(Intent(this@LoginActivity, MainActivity::class.java))
                    finish()
                } catch (e: Exception) {
                    val msg = e.message.orEmpty().ifBlank { e.toString() }
                    if (msg.contains("请先验证邮箱")) {
                        startActivity(
                            Intent(this@LoginActivity, VerifyActivity::class.java)
                                .putExtra("email", email.text.toString().trim().lowercase())
                        )
                    } else {
                        error.text = msg
                    }
                } finally {
                    submit.isEnabled = true
                    submit.isClickable = true
                }
            }
        }
        submit.setOnClickListener { doLogin() }
        password.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                doLogin()
                true
            } else {
                false
            }
        }
        findViewById<TextView>(R.id.goRegister).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener {
                startActivity(Intent(this@LoginActivity, RegisterActivity::class.java))
            }
        }
    }
}
