plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val previewBuild = providers.gradleProperty("preview").orNull == "true"

android {
    namespace = "org.sushi.club"
    compileSdk = 34
    defaultConfig {
        applicationId = if (previewBuild) "org.sushi.club.preview" else "org.sushi.club"
        minSdk = 24
        targetSdk = 34
        versionCode = 18
        versionName = if (previewBuild) "1.1.16-preview" else "1.1.16"
        manifestPlaceholders["sushiAppLabel"] = if (previewBuild) "苏轼AI 测试版" else "@string/app_name"
        buildConfigField("String", "DEFAULT_BASE_URL", "\"https://sushi-ai-server.onrender.com\"")
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
