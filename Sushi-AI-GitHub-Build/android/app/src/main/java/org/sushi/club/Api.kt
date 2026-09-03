package org.sushi.club

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.File
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

class ApiException(val code: Int, message: String) : Exception(message)

object Api {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val uaInterceptor = Interceptor { chain ->
        val req = chain.request()
        val builder = req.newBuilder()
            .header(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
            )
            .header("Accept", "application/json")
        val host = req.url.host.lowercase()
        if (host.contains("pinggy")) {
            builder.header("X-Pinggy-No-Screen", "true")
        }
        chain.proceed(builder.build())
    }

    private fun baseClient(): OkHttpClient.Builder =
        OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(25, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .protocols(listOf(Protocol.HTTP_1_1))
            .addInterceptor(uaInterceptor)

    private val client = baseClient().build()

    private val downloadClient = baseClient()
        .callTimeout(0, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .writeTimeout(5, TimeUnit.MINUTES)
        .build()

    suspend fun post(path: String, body: JSONObject = JSONObject(), auth: Boolean = true): JSONObject =
        call("POST", path, body, auth)

    suspend fun get(path: String, auth: Boolean = true): JSONObject =
        call("GET", path, null, auth)

    fun normalizeServerUrl(input: String): String {
        val raw = input.trim()
        if (raw.isBlank()) throw ApiException(0, "请填写服务器地址")
        val url = (if (raw.contains("://")) raw else "https://$raw").toHttpUrlOrNull()
            ?: throw ApiException(0, "服务器地址格式不正确")
        if (url.username.isNotBlank() || url.password.isNotBlank() || url.encodedPath != "/" || url.query != null || url.fragment != null) {
            throw ApiException(0, "请填写服务器首页地址，不要包含 APK 文件名、页面路径或登录信息")
        }
        return url.toString().trimEnd('/')
    }

    suspend fun probeServer(input: String): String = withContext(Dispatchers.IO) {
        val base = normalizeServerUrl(input)
        val probe = client.newBuilder().followRedirects(false).followSslRedirects(false)
            .callTimeout(15, TimeUnit.SECONDS).build()
        try {
            val request = Request.Builder().url("$base/api/app/version").get().build()
            probe.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw ApiException(response.code, "服务器返回 HTTP ${response.code}，请确认后端已启动")
                val data = try { JSONObject(response.body?.string().orEmpty()) }
                    catch (_: Exception) { throw ApiException(0, "该地址返回了网页，未找到苏轼AI后端接口") }
                if (data.opt("versionCode") !is Number) throw ApiException(0, "该地址不是兼容的苏轼AI后端")
                "连接成功，可以保存地址并登录"
            }
        } catch (e: Exception) { throw mapNetworkError(e) }
    }

    suspend fun download(path: String, dest: File) = withContext(Dispatchers.IO) {
        dest.parentFile?.mkdirs()
        val base = Session.baseUrl()
        if (base.isBlank()) throw ApiException(0, "请先设置服务器地址")
        val req = Request.Builder().url(base + path).get().build()
        try {
            downloadClient.newCall(req).execute().use { res ->
                if (!res.isSuccessful) throw ApiException(res.code, "下载失败")
                val body = res.body ?: throw ApiException(0, "空响应")
                dest.outputStream().use { out -> body.byteStream().copyTo(out) }
            }
        } catch (e: Exception) {
            throw mapNetworkError(e)
        }
    }

    private suspend fun call(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject =
        withContext(Dispatchers.IO) {
            try {
                val base = Session.baseUrl()
                if (base.isBlank()) throw ApiException(0, "请先设置服务器地址")
                val builder = Request.Builder().url(base + path)
                if (auth && Session.token().isNotBlank()) {
                    builder.header("Authorization", "Bearer ${Session.token()}")
                }
                builder.header("Accept", "application/json")
                if (method == "POST") {
                    builder.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
                } else {
                    builder.get()
                }
                client.newCall(builder.build()).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    val json = try { JSONObject(text) } catch (_: Exception) {
                        throw ApiException(res.code, if (res.isSuccessful) "服务器返回了网页，请检查服务器地址" else "服务器暂不可用（HTTP ${res.code}），请检查后端或隧道")
                    }
                    if (!res.isSuccessful) {
                        throw ApiException(res.code, json.optString("error", "请求失败"))
                    }
                    json
                }
            } catch (e: Exception) {
                throw mapNetworkError(e)
            }
        }

    private fun mapNetworkError(e: Exception): Exception {
        if (e is CancellationException) return e
        if (e is ApiException) return e
        var cause: Throwable? = e
        while (cause != null) {
            when (cause) {
                is UnknownHostException -> return ApiException(0, "服务器地址无法解析，请检查服务器地址或网络")
                is SocketTimeoutException -> return ApiException(0, "连接服务器超时，请检查网络或后端状态")
                is ConnectException -> return ApiException(0, "无法连接服务器，请确认后端和隧道正在运行")
                is SSLException -> return ApiException(0, "HTTPS连接失败，请检查服务器证书和手机时间")
            }
            cause = cause.cause
        }
        return ApiException(0, "连接服务器失败，请打开服务器设置检测连接")
    }
}
