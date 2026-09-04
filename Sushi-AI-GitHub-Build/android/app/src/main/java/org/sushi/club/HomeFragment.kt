package org.sushi.club

import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import androidx.fragment.app.Fragment

class HomeFragment : Fragment() {
    data class Tpl(val title: String, val prompt: String)

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.findViewById<Button>(R.id.goGen).setOnClickListener {
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.randomQuick).setOnClickListener {
            val item = templates().random()
            Session.setPendingPrompt(item.prompt)
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.imageQuick).setOnClickListener {
            Session.setPendingPrompt("上传人物原图或参考图后，描述希望更换或生成的背景。")
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.chatQuick).setOnClickListener {
            Session.setPendingPrompt("进入 AI 对话，可直接提问。")
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.aiImageQuick).setOnClickListener {
            Session.setPendingPrompt("请描述希望 AI 直接生成并在软件内显示的图片。")
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.historyQuick).setOnClickListener {
            Session.setPendingPrompt("查看最近生成图片，并继续上一次的生成记忆。")
            (activity as? MainActivity)?.openGen()
        }
        view.findViewById<Button>(R.id.toolsQuick).setOnClickListener {
            startActivity(Intent(requireContext(), MiniHubActivity::class.java))
        }
        bindTemplates(view.findViewById(R.id.tplGrid))
    }

    private fun bindTemplates(grid: LinearLayout) {
        grid.removeAllViews()
        val gap = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 10f, resources.displayMetrics).toInt()
        val rowH = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 52f, resources.displayMetrics).toInt()
        val items = templates().take(6)
        var i = 0
        while (i < items.size) {
            val row = LinearLayout(requireContext()).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { if (i > 0) it.topMargin = gap }
            }
            row.addView(tplButton(items[i], LinearLayout.LayoutParams(0, rowH, 1f)))
            if (i + 1 < items.size) {
                row.addView(View(requireContext()).apply { layoutParams = LinearLayout.LayoutParams(gap, 1) })
                row.addView(tplButton(items[i + 1], LinearLayout.LayoutParams(0, rowH, 1f)))
            } else {
                row.addView(View(requireContext()).apply { layoutParams = LinearLayout.LayoutParams(gap, 1) })
                row.addView(View(requireContext()).apply { layoutParams = LinearLayout.LayoutParams(0, rowH, 1f) })
            }
            grid.addView(row)
            i += 2
        }
    }

    private fun tplButton(tpl: Tpl, lp: LinearLayout.LayoutParams): Button {
        return Button(requireContext(), null, android.R.attr.buttonStyle).apply {
            layoutParams = lp
            text = tpl.title
            isAllCaps = false
            setTextColor(resources.getColor(R.color.text, null))
            textSize = 13f
            setBackgroundResource(R.drawable.bg_card)
            setOnClickListener {
                Session.setPendingPrompt(tpl.prompt)
                (activity as? MainActivity)?.openGen()
            }
        }
    }

    companion object {
        fun templates(): List<Tpl> = listOf(
            Tpl("写实人像", "虚构成年角色写实摄影人像，自然皮肤质感，真实五官，电影光影，非卡通，非动漫，高细节"),
            Tpl("电影夜景", "虚构成年角色站在雨夜城市街道，霓虹灯反射，电影级构图，写实摄影，低机位，高细节"),
            Tpl("古风人物", "虚构成年角色立于中式庭院，传统服饰，自然姿态，柔和月光，写实电影感，全身构图"),
            Tpl("室内写真", "虚构成年角色位于现代室内窗边，自然侧光，生活化姿态，写实摄影，真实皮肤与衣料细节"),
            Tpl("旅行街拍", "虚构成年旅人在城市街道行走，自然抓拍，真实光线，电影胶片感，写实摄影"),
            Tpl("角色设定", "虚构成年角色全身设定图，正面站姿，服装结构清晰，真实人体比例，干净背景，高细节"),
            Tpl("赛博夜市", "虚构成年旅人走在霓虹夜市雨后街道，全息招牌与蒸汽小吃摊，潮湿地面反光，电影广角，未来市集氛围"),
            Tpl("雪原旅人", "虚构成年旅人立于雪原与松林之间，厚实冬装，远山淡蓝，清冷空气感，全身远中景")
        )
    }
}
