@echo off
setlocal
set "SUSHI_WRAPPER_DIR=%~dp0"
set "SUSHI_JAVA=java.exe"
if defined JAVA_HOME set "SUSHI_JAVA=%JAVA_HOME%\bin\java.exe"
"%SUSHI_JAVA%" %JAVA_OPTS% %GRADLE_OPTS% -classpath "%SUSHI_WRAPPER_DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
