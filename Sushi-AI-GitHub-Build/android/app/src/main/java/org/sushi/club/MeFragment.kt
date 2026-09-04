package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

class MeFragment : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_me, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        paint(view)
        view.findViewById<Button>(R.id.serverBtn).visibility = View.GONE
        view.findViewById<Button>(R.id.checkUpdate).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener { checkNow(manual = true) }
        }
        view.findViewById<Button>(R.id.downloadApk).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener {
                AppUpdate.openDownload(requireContext(), Session.baseUrl().trimEnd('/') + "/api/app/download")
            }
        }
        view.findViewById<Button>(R.id.downloadUpdate).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener {
                AppUpdate.openDownload(requireContext(), Session.updateUrl())
            }
        }
        view.findViewById<Button>(R.id.logout).apply {
            isClickable = true
            isFocusable = true
            setOnClickListener {
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                WebStorage.getInstance().deleteAllData()
                Session.clear()
                startActivity(Intent(requireContext(), LoginActivity::class.java))
                requireActivity().finish()
            }
        }
        paintUpdate(view)
        refreshRemain(view)
    }

    override fun onResume() {
        super.onResume()
        view?.let {
            paint(it)
            paintUpdate(it)
            refreshRemain(it)
        }
        checkNow(manual = false)
    }

    private fun paint(view: View) {
        Session.restoreUser()
        val u = Session.user
        view.findViewById<TextView>(R.id.name).text = u?.optString("display_name")
        view.findViewById<TextView>(R.id.email).text = u?.optString("email")
        view.findViewById<TextView>(R.id.plan).text = "方案：" + if (u?.optString("plan") == "vip") "会员" else "免费"
        view.findViewById<TextView>(R.id.quota).text = "每日额度：" + u?.optInt("gen_quota_daily", 10)
        view.findViewById<TextView>(R.id.appVer).text = "当前版本 " + BuildConfig.VERSION_NAME
    }

    private fun refreshRemain(view: View) {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val q = Api.get("/api/me/quota")
                view.findViewById<TextView>(R.id.quotaRemain).text = "今日剩余：" + q.optInt("remaining")
            } catch (_: Exception) { }
        }
    }

    private fun paintUpdate(view: View) {
        val banner = view.findViewById<LinearLayout>(R.id.updateBanner)
        val msg = view.findViewById<TextView>(R.id.updateMsg)
        val newer = Session.updateAvailable() && Session.updateCode() > BuildConfig.VERSION_CODE
        banner.visibility = if (newer) View.VISIBLE else View.GONE
        if (newer) {
            val name = Session.updateName().ifBlank { "新版本" }
            msg.text = "发现新版本 " + name
        }
        (activity as? MainActivity)?.refreshUpdateBadge()
    }

    private fun checkNow(manual: Boolean) {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val info = withTimeout(8_000) { Api.get(AppUpdate.path(), auth = false) }
                val newer = AppUpdate.remember(info)
                val v = view ?: return@launch
                paintUpdate(v)
                if (manual) {
                    if (newer) {
                        Toast.makeText(requireContext(), "发现新版本 " + AppUpdate.remoteName(info), Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(requireContext(), "已是最新版本", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (_: Exception) {
                if (manual) {
                    Toast.makeText(requireContext(), "暂时无法连接", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
