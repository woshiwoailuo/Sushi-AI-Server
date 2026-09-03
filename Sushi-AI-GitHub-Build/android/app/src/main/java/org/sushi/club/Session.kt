package org.sushi.club

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import org.json.JSONObject

object Session {
    private lateinit var prefs: SharedPreferences
    var user: JSONObject? = null

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("sushi_club", Context.MODE_PRIVATE)
        restoreUser()
    }

    fun token(): String = prefs.getString("jwt", "") ?: ""
    fun setToken(t: String) {
        prefs.edit().putString("jwt", t).putLong("token_at", System.currentTimeMillis()).apply()
    }

    fun lastVerifiedAt(): Long = prefs.getLong("me_ok_at", 0L)
    fun markVerified() {
        prefs.edit().putLong("me_ok_at", System.currentTimeMillis()).apply()
    }

    fun sessionFresh(): Boolean {
        val t = token()
        if (t.isBlank()) return false
        if (jwtUnexpired(t)) return true
        val last = lastVerifiedAt()
        return last > 0L && System.currentTimeMillis() - last < 15 * 60 * 1000L
    }

    fun jwtUnexpired(t: String = token()): Boolean {
        return try {
            val parts = t.split(".")
            if (parts.size < 2) return t.isNotBlank()
            var payload = parts[1]
            val pad = (4 - payload.length % 4) % 4
            if (pad > 0) payload += "=".repeat(pad)
            val json = JSONObject(String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP)))
            val exp = json.optLong("exp", 0L)
            if (exp <= 0L) t.isNotBlank()
            else exp * 1000L > System.currentTimeMillis() + 20_000L
        } catch (_: Exception) {
            t.isNotBlank()
        }
    }

    fun persistUser(u: JSONObject?) {
        user = u
        if (u == null) {
            prefs.edit().remove("user_json").apply()
        } else {
            prefs.edit().putString("user_json", u.toString()).apply()
            markVerified()
        }
    }

    fun restoreUser() {
        if (user != null) return
        val raw = prefs.getString("user_json", "") ?: ""
        if (raw.isNotBlank()) {
            try { user = JSONObject(raw) } catch (_: Exception) {}
        }
    }

    fun adultPrefOn() {
        prefs.edit().putBoolean("adult_on", true).apply()
    }

    fun isAdultOn(): Boolean = prefs.getBoolean("adult_on", true)

    fun lastTab(): String = prefs.getString("last_tab", "gen") ?: "gen"
    fun setLastTab(tab: String) {
        prefs.edit().putString("last_tab", tab).apply()
    }

    fun pendingPrompt(): String = prefs.getString("pending_prompt", "") ?: ""
    fun setPendingPrompt(prompt: String) {
        prefs.edit().putString("pending_prompt", prompt).apply()
    }
    fun consumePendingPrompt(): String {
        val p = pendingPrompt()
        if (p.isNotBlank()) prefs.edit().remove("pending_prompt").apply()
        return p
    }

    fun clear() {
        user = null
        prefs.edit()
            .remove("jwt")
            .remove("user_json")
            .remove("me_ok_at")
            .remove("token_at")
            .apply()
    }

    fun baseUrl(): String {
        val stored = (prefs.getString("base_url", "") ?: "").trim().trimEnd('/')
        if (stored.isNotBlank()) return stored
        return BuildConfig.DEFAULT_BASE_URL.trim().trimEnd('/')
    }

    fun hasServerUrl(): Boolean = baseUrl().isNotBlank()

    fun setBaseUrl(url: String) {
        prefs.edit().putString("base_url", url.trim().trimEnd('/')).apply()
    }

    fun markUpdate(name: String, code: Int, url: String) {
        prefs.edit()
            .putBoolean("upd_avail", true)
            .putString("upd_name", name)
            .putInt("upd_code", code)
            .putString("upd_url", url)
            .apply()
    }

    fun clearUpdate() {
        prefs.edit()
            .putBoolean("upd_avail", false)
            .remove("upd_name")
            .remove("upd_code")
            .remove("upd_url")
            .apply()
    }

    fun updateAvailable(): Boolean = prefs.getBoolean("upd_avail", false)
    fun updateName(): String = prefs.getString("upd_name", "") ?: ""
    fun updateCode(): Int = prefs.getInt("upd_code", 0)
    fun updateUrl(): String = prefs.getString("upd_url", "") ?: ""
}
