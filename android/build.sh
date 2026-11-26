#!/usr/bin/env bash
# Compila la APK de Taller3DPanel sin Android Studio ni Gradle.
# Necesita: Java (JDK), aapt2, dx (dalvik-exchange), zipalign y apksigner.
# En Ubuntu/Debian: sudo apt install default-jdk aapt apksigner zipalign dalvik-exchange
#
# Uso:  ./build.sh                 -> APK firmada con una clave de prueba (debug)
#       KEYSTORE=mi.jks KS_PASS=... KEY_ALIAS=... ./build.sh   -> APK firmada con tu clave
#
# android.jar: usa $ANDROID_JAR, o el del SDK (platforms/android-34) si existe,
# o descarga el de Robolectric (API 34) desde Maven Central.
set -euo pipefail
cd "$(dirname "$0")"
OUT=build
rm -rf "$OUT"; mkdir -p "$OUT"/{gen,classes}

if [ -z "${ANDROID_JAR:-}" ]; then
  for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk"; do
    [ -n "$d" ] && [ -f "$d/platforms/android-34/android.jar" ] && ANDROID_JAR="$d/platforms/android-34/android.jar" && break
  done
fi
if [ -z "${ANDROID_JAR:-}" ]; then
  V=14-robolectric-10818077
  ANDROID_JAR=".cache/android-all-$V.jar"
  if [ ! -f "$ANDROID_JAR" ]; then
    mkdir -p .cache
    echo "Descargando android.jar (API 34) de Maven Central..."
    curl -fL -o "$ANDROID_JAR" "https://repo1.maven.org/maven2/org/robolectric/android-all/$V/android-all-$V.jar"
  fi
fi
VERSION_CODE=$(grep -o 'versionCode="[0-9]*"' src/main/AndroidManifest.xml | grep -o '[0-9]*')
VERSION_NAME=$(grep -o 'versionName="[^"]*"' src/main/AndroidManifest.xml | cut -d'"' -f2)
DX=$(command -v d8 || command -v dalvik-exchange || command -v dx)

echo "1/5 Recursos"
aapt2 compile --dir src/main/res -o "$OUT/res.zip"
aapt2 link -I "$ANDROID_JAR" --manifest src/main/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$OUT/gen" -o "$OUT/base.apk" "$OUT/res.zip"

echo "2/5 Java"
javac -nowarn -Xlint:-options -encoding UTF-8 --release 8 -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find "$OUT/gen" src/main/java -name '*.java')

echo "3/5 Dex"
case "$DX" in
  *d8) "$DX" --min-api 24 --lib "$ANDROID_JAR" --output "$OUT" $(find "$OUT/classes" -name '*.class') ;;
  *)   "$DX" --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes" ;;
esac
(cd "$OUT" && zip -q -j base.apk classes.dex)

echo "4/5 Alinear"
zipalign -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "5/5 Firmar"
if [ -z "${KEYSTORE:-}" ]; then
  KEYSTORE=.cache/debug.jks; KS_PASS=android; KEY_ALIAS=debug
  [ -f "$KEYSTORE" ] || keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
      -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Taller3D Panel debug" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" \
  --out "$OUT/Taller3DPanel-$VERSION_NAME.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/Taller3DPanel-$VERSION_NAME.apk"
echo "Lista: $OUT/Taller3DPanel-$VERSION_NAME.apk"
mkdir -p dist && cp "$OUT/Taller3DPanel-$VERSION_NAME.apk" dist/Taller3DPanel.apk
