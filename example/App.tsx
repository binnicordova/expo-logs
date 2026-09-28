import { StatusBar } from 'expo-status-bar';
import { FileLogger, LogLevel, logLevelNames, type LogFileInfo } from 'expo-logs';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const api = FileLogger.createLogger('Api');

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const dark = useColorScheme() === 'dark';
  const c = dark ? darkColors : lightColors;
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [preview, setPreview] = useState('');
  const [level, setLevel] = useState(FileLogger.getLogLevel());
  const [capturing, setCapturing] = useState(true);

  const refresh = useCallback(async () => {
    const list = await FileLogger.getLogFiles();
    setFiles(list);
    const last = list[list.length - 1];
    const text = last ? await FileLogger.readLogFile(last.name) : '';
    setPreview(text.trimEnd().split('\n').slice(-30).join('\n'));
    setCapturing(FileLogger.isConsoleCaptureEnabled());
  }, []);

  useEffect(() => {
    const id = setTimeout(refresh, 300);
    return () => clearTimeout(id);
  }, [refresh]);

  const run = (fn: () => unknown) => async () => {
    try {
      await fn();
    } catch (error) {
      const e = error as Error & { code?: string };
      Alert.alert(e.code ?? 'Error', e.message);
    }
    await refresh();
  };

  const actions: { label: string; onPress: () => unknown; tone?: 'danger' }[] = [
    { label: 'console.debug', onPress: () => console.debug('debug from', Platform.OS) },
    { label: 'console.log', onPress: () => console.log('user %s signed in', 'ana', { id: 7 }) },
    { label: 'console.warn', onPress: () => console.warn('low battery', { level: 0.12 }) },
    { label: 'console.error', onPress: () => console.error(new Error('Something failed')) },
    { label: 'Tagged logger', onPress: () => api.info('GET /users', 200, '84ms') },
    {
      label: 'Write 500 lines',
      onPress: () => {
        for (let i = 0; i < 500; i++) FileLogger.info(`stress line #${i} ${'.'.repeat(20)}`);
      },
    },
    {
      label: `Level: ${logLevelNames[level]}`,
      onPress: () => {
        const next = ((level + 1) % 4) as LogLevel;
        FileLogger.setLogLevel(next);
        setLevel(next);
      },
    },
    {
      label: capturing ? 'Stop console capture' : 'Start console capture',
      onPress: () =>
        capturing ? FileLogger.disableConsoleCapture() : FileLogger.enableConsoleCapture(),
    },
    { label: 'Share logs', onPress: () => FileLogger.shareLogFiles({ dialogTitle: 'App logs' }) },
    { label: 'Share as .zip', onPress: () => FileLogger.shareLogFiles({ compressFiles: true }) },
    {
      label: 'Email logs',
      onPress: () =>
        FileLogger.sendLogFilesByEmail({
          to: 'support@example.com',
          subject: 'expo-logs example',
          body: 'Logs attached.',
          compressFiles: true,
        }),
    },
    { label: 'Delete logs', onPress: () => FileLogger.deleteLogFiles(), tone: 'danger' },
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: c.text }]}>expo-logs</Text>
        <Text style={[styles.subtitle, { color: c.muted }]}>
          Pure TypeScript file logger · {Platform.OS}
        </Text>

        <View style={styles.grid}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={run(a.onPress)}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: a.tone === 'danger' ? c.danger : c.accent },
                pressed && { opacity: 0.7 },
              ]}>
              <Text style={styles.buttonText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.row}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Files ({files.length})</Text>
            <Pressable onPress={refresh}>
              <Text style={{ color: c.accent, fontWeight: '600' }}>Refresh</Text>
            </Pressable>
          </View>
          {files.length === 0 ? (
            <Text style={{ color: c.muted }}>No log files yet.</Text>
          ) : (
            files.map((f) => (
              <View key={f.uri} style={styles.row}>
                <Text style={[styles.mono, { color: c.text, flex: 1 }]} numberOfLines={1}>
                  {f.name}
                </Text>
                <Text style={[styles.mono, { color: c.muted }]}>{formatBytes(f.size)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Latest file (tail)</Text>
          <Text testID="log-preview" style={[styles.mono, { color: c.text }]}>
            {preview || '—'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const lightColors = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  text: '#111114',
  muted: '#6B6B73',
  accent: '#3B5BDB',
  danger: '#C92A2A',
};
const darkColors = {
  bg: '#000000',
  card: '#1C1C1E',
  text: '#F2F2F7',
  muted: '#98989F',
  accent: '#5C7CFA',
  danger: '#E03131',
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 15, marginTop: -12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  card: { borderRadius: 12, padding: 14, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
});
