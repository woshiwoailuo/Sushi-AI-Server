package org.sushi.club

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
        view.findViewById<Button>(R.id.goGen).apply {
            isClickable = true
            isEnabled = true
            isFocusable = true
            setOnClickListener { (activity as? MainActivity)?.openGen() }
        }
        bindTemplates(view.findViewById(R.id.tplGrid))
    }

    private fun bindTemplates(grid: LinearLayout) {
        grid.removeAllViews()
        val gap = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 10f, resources.displayMetrics).toInt()
        val rowH = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 52f, resources.displayMetrics).toInt()
        val items = templates()
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
                val spacer = View(requireContext())
                spacer.layoutParams = LinearLayout.LayoutParams(gap, 1)
                row.addView(spacer)
                row.addView(tplButton(items[i + 1], LinearLayout.LayoutParams(0, rowH, 1f)))
            } else {
                val filler = View(requireContext())
                filler.layoutParams = LinearLayout.LayoutParams(0, rowH, 1f)
                row.addView(View(requireContext()).apply { layoutParams = LinearLayout.LayoutParams(gap, 1) })
                row.addView(filler)
            }
            grid.addView(row)
            i += 2
        }
    }

    private fun tplButton(tpl: Tpl, lp: LinearLayout.LayoutParams): Button {
        return Button(requireContext(), null, android.R.attr.buttonStyle).apply {
            layoutParams = lp
            text = tpl.title
            isClickable = true
            isEnabled = true
            isFocusable = true
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
            Tpl("古风书生月下", "虚构成年书生立于庭院月下，青衫长袍，手持卷轴，月光清冷，水墨与工笔结合，全身构图，精致细节，电影感光影"),
            Tpl("赛博夜市", "虚构成年旅人走在霓虹夜市雨后街道，全息招牌与蒸汽小吃摊，潮湿地面反光，电影广角，未来市集氛围"),
            Tpl("油画肖像", "虚构成年角色半身油画肖像，伦勃朗式侧光，厚涂笔触，古典画室背景，神情平静，高细节皮肤与衣料"),
            Tpl("雨巷旗袍", "虚构成年女子撑油纸伞走在江南雨巷，旗袍剪裁端庄，青石板湿润反光，电影胶片色，全身中景"),
            Tpl("水墨仙侠", "虚构成年仙侠立于云海孤峰，水墨渲染与淡彩，广袖道袍，远山留白，清冷仙气，全身构图"),
            Tpl("室内光影", "虚构成年角色坐在落地窗前阅读，午后阳光切进室内，体积光与柔和阴影，写实摄影，安静生活感"),
            Tpl("电影分镜", "虚构成年角色在列车车厢靠窗，过道景深虚化，电影分镜中景，自然光，纪实与剧情片质感"),
            Tpl("角色三视图", "虚构成年角色设定三视图，正面侧面背面并列，干净白底，服装结构清晰，概念设定图风格"),
            Tpl("图书馆午后", "虚构成年学者坐在木质图书馆长桌，阳光透过高窗，书堆与尘埃光柱，安静氛围，写实光影"),
            Tpl("雪原旅人", "虚构成年旅人立于雪原与松林之间，厚实冬装，远山淡蓝，清冷空气感，全身远中景"),
            Tpl("工坊静物", "虚构角色工作室一角，画架颜料与台灯暖光，静物构图，细节丰富，室内写实"),
            Tpl("星空屋顶", "虚构成年角色坐在老城区屋顶看星空，城市灯火在脚下，仰角构图，安静夜色，电影感")
        )
    }
}
