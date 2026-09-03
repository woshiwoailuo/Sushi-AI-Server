package org.sushi.club

import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject

object AppUpdate {
    fun path(): String = "/api/app/version?versionCode=" + BuildConfig.VERSION_CODE

    fun remoteCode(info: JSONObject): Int {
        val camel = info.optInt("versionCode", 0)
        if (camel > 0) return camel
        return info.optInt("version_code", 0)
    }

    fun remoteName(info: JSONObject): String {
        val n = info.optString("versionName", "")
        if (n.isNotBlank()) return n
        return info.optString("version_name", "")
    }

    fun downloadUrl(info: JSONObject): String {
        val base = Session.baseUrl().trimEnd('/')
        val raw = info.optString("url", "").trim()
        val resolved = when {
            raw.startsWith("http://") || raw.startsWith("https://") -> raw
            raw.startsWith("/") -> base + raw
            else -> "$base/api/app/download"
        }
        return resolved.ifBlank { "$base/sushi-ai.apk" }
    }

    fun remember(info: JSONObject): Boolean {
        val code = remoteCode(info)
        if (code > BuildConfig.VERSION_CODE) {
            Session.markUpdate(remoteName(info), code, downloadUrl(info))
            return true
        }
        Session.clearUpdate()
        return false
    }

    fun openDownload(ctx: Context, url: String) {
        val target = url.ifBlank {
            val stored = Session.updateUrl()
            if (stored.isNotBlank()) stored else Session.baseUrl().trimEnd('/') + "/api/app/download"
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }
}
