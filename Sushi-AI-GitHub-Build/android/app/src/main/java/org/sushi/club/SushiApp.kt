package org.sushi.club

import android.app.Application

class SushiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Session.init(this)
        Session.adultPrefOn()
        Session.restoreUser()
    }
}
