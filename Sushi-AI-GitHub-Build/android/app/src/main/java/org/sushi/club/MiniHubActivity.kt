package org.sushi.club

import android.os.Bundle
import android.os.CountDownTimer
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.random.Random

class MiniHubActivity : AppCompatActivity() {
    private var timer: CountDownTimer? = null
    private var secret = Random.nextInt(1, 101)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "实用工具与小游戏"

        val pad = (18 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)

        root.addView(TextView(this).apply {
            text = "实用工具"
            textSize = 24f
            setTextColor(getColor(R.color.text))
        })
        root.addView(TextView(this).apply {
            text = "轻量、离线优先，不占用生图或 AI 算力。"
            setTextColor(getColor(R.color.muted))
        })

        val choices = EditText(this).apply {
            hint = "随机决定：用逗号分隔，例如 吃饭,散步,创作"
            setSingleLine(false)
        }
        root.addView(choices, lp(top = 18))
        val decision = TextView(this).apply {
            text = "输入选项后点击随机决定"
            gravity = Gravity.CENTER
            setTextColor(getColor(R.color.text))
        }
        root.addView(Button(this).apply {
            text = "随机决定"
            isAllCaps = false
            setOnClickListener {
                val items = choices.text.toString().split(',', '，', '\n').map { it.trim() }.filter { it.isNotBlank() }
                decision.text = if (items.isEmpty()) "请先输入至少一个选项" else "结果：${items.random()}"
            }
        }, lp(top = 8))
        root.addView(decision, lp(top = 8))

        val timerText = TextView(this).apply {
            text = "专注计时：未开始"
            gravity = Gravity.CENTER
            setTextColor(getColor(R.color.text))
        }
        root.addView(timerText, lp(top = 24))
        val timerRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(1 to "1 分钟", 5 to "5 分钟", 25 to "25 分钟").forEach { (minutes, label) ->
            timerRow.addView(Button(this).apply {
                text = label
                isAllCaps = false
                setOnClickListener {
                    timer?.cancel()
                    timer = object : CountDownTimer(minutes * 60_000L, 1_000L) {
                        override fun onTick(ms: Long) {
                            val s = ms / 1000
                            timerText.text = "剩余 %02d:%02d".format(s / 60, s % 60)
                        }
                        override fun onFinish() { timerText.text = "计时完成" }
                    }.start()
                }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        root.addView(timerRow, lp(top = 8))

        root.addView(TextView(this).apply {
            text = "小游戏 · 猜数字 1–100"
            textSize = 18f
            setTextColor(getColor(R.color.text))
        }, lp(top = 28))
        val guess = EditText(this).apply {
            hint = "输入数字"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        root.addView(guess, lp(top = 8))
        val hint = TextView(this).apply {
            text = "我已经想好一个数字"
            gravity = Gravity.CENTER
            setTextColor(getColor(R.color.text))
        }
        root.addView(Button(this).apply {
            text = "猜一下"
            isAllCaps = false
            setOnClickListener {
                val n = guess.text.toString().toIntOrNull()
                hint.text = when {
                    n == null -> "请输入 1–100 的数字"
                    n < secret -> "小了"
                    n > secret -> "大了"
                    else -> "猜对了！已自动开始新一局".also { secret = Random.nextInt(1, 101) }
                }
            }
        }, lp(top = 8))
        root.addView(hint, lp(top = 8))
    }

    private fun lp(top: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = (top * resources.displayMetrics.density).toInt()
        }

    override fun onDestroy() {
        timer?.cancel()
        super.onDestroy()
    }
}
