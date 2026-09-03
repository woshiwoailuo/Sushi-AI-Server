package org.sushi.club

import android.os.Bundle
import android.view.View
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

class MainActivity : AppCompatActivity() {
    private val home = HomeFragment()
    private val gen = GenFragment()
    private val me = MeFragment()
    private var current: Fragment? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Session.adultPrefOn()
        Session.restoreUser()
        setContentView(R.layout.activity_main)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .add(R.id.container, home, "home")
                .add(R.id.container, gen, "gen")
                .add(R.id.container, me, "me")
                .hide(home)
                .hide(gen)
                .hide(me)
                .commitNow()
        }
        bindNav()
        switchTo(gen, "gen")
        refreshMeInBackground()
        lifecycleScope.launch { quietVersionCheck() }
    }

    fun refreshUpdateBadge() {
        val dot = findViewById<View>(R.id.nav_me_dot) ?: return
        val show = Session.updateAvailable() && Session.updateCode() > BuildConfig.VERSION_CODE
        dot.visibility = if (show) View.VISIBLE else View.GONE
    }

    private suspend fun quietVersionCheck() {
        try {
            val info = withTimeout(4_000) { Api.get(AppUpdate.path(), auth = false) }
            AppUpdate.remember(info)
        } catch (_: Exception) {
        }
        refreshUpdateBadge()
    }

    private fun bindNav() {
        findViewById<Button>(R.id.nav_home).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener { switchTo(home, "home") }
        }
        findViewById<Button>(R.id.nav_gen).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener { switchTo(gen, "gen") }
        }
        findViewById<Button>(R.id.nav_me).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener { switchTo(me, "me") }
        }
    }

    fun openGen() {
        switchTo(gen, "gen")
    }

    private fun switchTo(f: Fragment, tab: String) {
        val tx = supportFragmentManager.beginTransaction()
        listOf(home, gen, me).forEach { frag ->
            if (frag.isAdded) {
                if (frag === f) tx.show(frag) else tx.hide(frag)
            }
        }
        if (!f.isAdded) tx.add(R.id.container, f, tab)
        tx.commitNowAllowingStateLoss()
        current = f
        Session.setLastTab(tab)
        paintNav(tab)
        refreshUpdateBadge()
    }

    private fun paintNav(tab: String) {
        val accent = getColor(R.color.accent)
        val muted = getColor(R.color.muted)
        findViewById<Button>(R.id.nav_home).setTextColor(if (tab == "home") accent else muted)
        findViewById<Button>(R.id.nav_gen).setTextColor(if (tab == "gen") accent else muted)
        findViewById<Button>(R.id.nav_me).setTextColor(if (tab == "me") accent else muted)
    }

    private fun refreshMeInBackground() {
        if (Session.token().isBlank()) return
        if (Session.sessionFresh() && Session.user != null) {
            lifecycleScope.launch {
                try {
                    withTimeout(8_000) {
                        val me = Api.get("/api/me")
                        Session.persistUser(me.optJSONObject("user"))
                    }
                } catch (_: Exception) {
                }
            }
            return
        }
        lifecycleScope.launch {
            try {
                withTimeout(8_000) {
                    val data = Api.get("/api/me")
                    Session.persistUser(data.optJSONObject("user"))
                }
            } catch (_: Exception) {
            }
        }
    }
}
