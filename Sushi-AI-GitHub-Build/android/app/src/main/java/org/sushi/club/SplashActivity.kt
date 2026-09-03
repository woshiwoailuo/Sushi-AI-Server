package org.sushi.club

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

class SplashActivity : AppCompatActivity() {
    private var navigated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)
        Session.adultPrefOn()
        Session.restoreUser()
        proceed()
        lifecycleScope.launch { checkUpdateQuiet() }
    }

    private suspend fun checkUpdateQuiet() {
        try {
            val info = withTimeout(3_000) { Api.get(AppUpdate.path(), auth = false) }
            AppUpdate.remember(info)
        } catch (_: Exception) {
        }
    }

    private fun proceed() {
        if (navigated) return
        navigated = true
        Session.restoreUser()
        val hasToken = Session.token().isNotBlank() && Session.jwtUnexpired()
        if (hasToken || Session.sessionFresh() || Session.token().isNotBlank()) {
            startActivity(
                Intent(this, MainActivity::class.java).putExtra("open_gen", true)
            )
        } else {
            startActivity(Intent(this, LoginActivity::class.java))
        }
        finish()
    }
}
