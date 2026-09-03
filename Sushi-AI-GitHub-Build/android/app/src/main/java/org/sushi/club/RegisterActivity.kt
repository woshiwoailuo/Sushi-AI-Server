package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.widget.NestedScrollView
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class RegisterActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_register)
        val scroll = findViewById<NestedScrollView>(R.id.scroll)
        val name = findViewById<EditText>(R.id.displayName)
        val email = findViewById<EditText>(R.id.email)
        val password = findViewById<EditText>(R.id.password)
        val password2 = findViewById<EditText>(R.id.password2)
        val error = findViewById<TextView>(R.id.error)
        val submit = findViewById<TextView>(R.id.submit)
        submit.isEnabled = true
        submit.isClickable = true
        submit.isFocusable = true
        val doRegister = {
            error.text = "注册中…"
            submit.isEnabled = false
            submit.isClickable = false
            if (password.text.toString() != password2.text.toString()) {
                error.text = getString(R.string.password_mismatch)
                submit.isEnabled = true
                submit.isClickable = true
            } else {
                lifecycleScope.launch {
                    try {
                        val body = JSONObject()
                            .put("email", email.text.toString())
                            .put("password", password.text.toString())
                            .put("display_name", name.text.toString())
                        val data = Api.post("/api/auth/register", body, auth = false)
                        if (data.optBoolean("need_verify")) {
                            startActivity(
                                Intent(this@RegisterActivity, VerifyActivity::class.java)
                                    .putExtra("email", data.optString("email", email.text.toString()))
                            )
                            finish()
                            return@launch
                        }
                        Session.setToken(data.getString("token"))
                        Session.persistUser(data.getJSONObject("user"))
                        startActivity(Intent(this@RegisterActivity, MainActivity::class.java).putExtra("open_gen", true))
                        finishAffinity()
                    } catch (e: Exception) {
                        error.text = e.message.orEmpty().ifBlank { e.toString() }
                    } finally {
                        submit.isEnabled = true
                        submit.isClickable = true
                    }
                }
            }
        }
        submit.setOnClickListener { doRegister() }
        password2.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                doRegister()
                true
            } else {
                false
            }
        }
        val bringSubmitIntoView = {
            scroll.post { scroll.smoothScrollTo(0, submit.bottom) }
        }
        listOf(name, email, password, password2).forEach { field ->
            field.setOnFocusChangeListener { _, hasFocus ->
                if (hasFocus) bringSubmitIntoView()
            }
        }
        findViewById<TextView>(R.id.goLogin).setOnClickListener { finish() }
    }
}
