// Market.exe: la aplicación de escritorio de recepción, en un solo archivo.
// Trae adentro (como recurso) el zip con Node portátil, el servidor, la vista de recepción y
// las DLL de WebView2. Al abrirlo:
//   1. Se instala en %LOCALAPPDATA%\Market (la primera vez o si cambió la versión, sin tocar
//      los datos) y crea los accesos directos en el escritorio y en el menú Inicio.
//   2. Levanta el servidor sin ventanas.
//   3. Muestra la vista de recepción en su propia ventana (WebView2, el motor de Edge que ya
//      trae Windows). Cerrar la ventana cierra Market.
// Si el equipo no tiene WebView2, abre la vista en el navegador y deja un icono junto al reloj.
// Se compila con el csc.exe de .NET Framework 4 (C# 5), desde scripts/empaquetar-pc.mjs.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Datos del programa (clic derecho en Market.exe → Propiedades → Detalles).
[assembly: AssemblyTitle("Market")]
[assembly: AssemblyProduct("Market · Recepción")]
[assembly: AssemblyDescription("Market · control de minibar para recepción. Desarrollado por Pirelix.")]
[assembly: AssemblyCompany("Pirelix")]
[assembly: AssemblyCopyright("© 2026 Pirelix. Todos los derechos reservados.")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    public const string Title = "Market · Recepción";
    public const string Url = "http://127.0.0.1:4000/?rol=recepcion";
    const string Health = "http://127.0.0.1:4000/api/health";
    public static string home;
    public static Process server;

    [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

    [STAThread]
    static void Main()
    {
        bool first;
        var mutex = new Mutex(true, "Market.Recepcion", out first);
        if (!first)
        {
            // Ya está abierto: se trae su ventana al frente.
            IntPtr h = FindWindow(null, Title);
            if (h != IntPtr.Zero)
            {
                if (IsIconic(h)) ShowWindow(h, 9);
                SetForegroundWindow(h);
            }
            else OpenBrowser();
            return;
        }
        home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Market");
        ServicePointManager.DefaultConnectionLimit = 32;
        // Las DLL de WebView2 viven en la carpeta instalada.
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object s, ResolveEventArgs a)
        {
            string file = Path.Combine(home, "bin", new AssemblyName(a.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Fail(e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Fail(e.ExceptionObject as Exception); };
        try
        {
            Run();
        }
        catch (Exception e)
        {
            Fail(e);
        }
        GC.KeepAlive(mutex);
    }

    // Bitácora de arranque (home\inicio.log): ayuda a ver dónde se quedó si algo falla.
    public static void Trace(string step)
    {
        try { File.AppendAllText(Path.Combine(home, "inicio.log"), DateTime.Now.ToString("HH:mm:ss.fff") + "  " + step + Environment.NewLine); } catch { }
    }

    static void Fail(Exception e)
    {
        try
        {
            Directory.CreateDirectory(home);
            File.AppendAllText(Path.Combine(home, "error.log"), DateTime.Now + "  " + e + Environment.NewLine);
        }
        catch { }
        StopServer();
        MessageBox.Show("Market tuvo un error y se cerró:\n" + (e == null ? "" : e.Message), "Market", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Environment.Exit(1);
    }

    static void Run()
    {
        var splash = new Splash();
        splash.Show();
        Application.DoEvents();
        try
        {
            Install(splash);
            Trace("instalado " + BuildInfo.Version);
            splash.SetText("Iniciando Market…");
            if (!IsUp() && !StartServer())
            {
                splash.Close();
                MessageBox.Show(
                    "Market no pudo iniciar.\n\nPuede que otro programa esté usando el puerto 4000.\nDetalle en:\n" + LogPath(),
                    "Market", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }
        catch (Exception e)
        {
            splash.Close();
            MessageBox.Show("Market no pudo prepararse:\n" + e.Message, "Market", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Trace("servidor listo");
        if (HasWebView2())
        {
            Trace("webview2 disponible");
            Form window = NewMainWindow();
            Trace("ventana creada");
            window.Shown += delegate { splash.Close(); };
            Application.Run(window);
        }
        else
        {
            Trace("sin webview2: navegador");
            splash.Close();
            OpenBrowser();
            Tray.Run();
        }
        StopServer();
    }

    // Separado para que las clases de WebView2 se carguen solo después de instalar las DLL.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static bool HasWebView2()
    {
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(home, "bin"));
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch
        {
            return false;
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static Form NewMainWindow()
    {
        return new MainWindow();
    }

    // ---------- Instalación ----------

    static string ExeInHome()
    {
        return Path.Combine(home, "Market.exe");
    }

    static void Install(Splash splash)
    {
        string marker = Path.Combine(home, "version.txt");
        bool current = File.Exists(marker) && File.ReadAllText(marker).Trim() == BuildInfo.Version;
        if (current && File.Exists(ExeInHome())) return;
        splash.SetText("Instalando Market…");
        KillOldServers();
        Directory.CreateDirectory(home);
        using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("market.zip"))
        using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
        {
            int done = 0, total = zip.Entries.Count;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                done++;
                string name = e.FullName.Replace('\\', '/');
                if (name.StartsWith("Market/")) name = name.Substring(7);
                // Los datos del hotel nunca se reemplazan.
                if (name.Length == 0 || name.EndsWith("/") || name.StartsWith("server/data/")) continue;
                string dest = Path.Combine(home, name.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                if (done % 100 == 0) splash.SetText("Instalando Market… " + (done * 100 / total) + "%");
            }
        }
        // Una copia del programa queda en la carpeta instalada: a ella apuntan los accesos directos.
        string self = Application.ExecutablePath;
        if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(ExeInHome()), StringComparison.OrdinalIgnoreCase))
            File.Copy(self, ExeInHome(), true);
        CreateShortcuts();
        File.WriteAllText(marker, BuildInfo.Version);
    }

    static void CreateShortcuts()
    {
        string[] places =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
        };
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        object shell = Activator.CreateInstance(shellType);
        foreach (string dir in places)
        {
            try
            {
                if (string.IsNullOrEmpty(dir)) continue;
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell,
                    new object[] { Path.Combine(dir, "Market.lnk") });
                Type t = lnk.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { ExeInHome() });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { home });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { ExeInHome() + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "Market · recepción del minibar. Desarrollado por Pirelix." });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            }
            catch { }
        }
    }

    // Un servidor viejo de esta misma carpeta tendría bloqueados los archivos o el puerto.
    static void KillOldServers()
    {
        string node = Path.Combine(home, "node", "node.exe");
        foreach (Process p in Process.GetProcessesByName("node"))
        {
            try
            {
                if (string.Equals(p.MainModule.FileName, node, StringComparison.OrdinalIgnoreCase))
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }
        }
    }

    // ---------- Servidor ----------

    static string LogPath()
    {
        return Path.Combine(home, "market.log");
    }

    static bool StartServer()
    {
        Trace("iniciando servidor");
        KillOldServers();
        Trace("servidores viejos cerrados");
        // La salida va directo a market.log (sin tuberías: si Market se cierra de golpe, el
        // servidor no se queda trabado escribiendo a nadie).
        string node = Path.Combine(home, "node", "node.exe");
        var psi = new ProcessStartInfo("cmd.exe",
            "/d /c \"\"" + node + "\" --no-warnings server\\src\\index.js > \"" + LogPath() + "\" 2>&1\"")
        {
            WorkingDirectory = home,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        server = Process.Start(psi);
        Trace("proceso del servidor " + server.Id);
        for (int i = 0; i < 80; i++)
        {
            if (server.HasExited)
            {
                Trace("el servidor se cerró");
                return false;
            }
            if (IsUp()) return true;
            if (i % 8 == 0) Trace("esperando al servidor… " + lastError);
            Thread.Sleep(250);
        }
        return false;
    }

    static bool IsUp()
    {
        try
        {
            // Conexión nueva cada vez y con límite total: una consulta vencida no deja
            // la siguiente esperando.
            var req = (HttpWebRequest)WebRequest.Create(Health);
            req.Proxy = null;
            req.KeepAlive = false;
            req.Timeout = 1500;
            req.ReadWriteTimeout = 1500;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream()))
                return r.ReadToEnd().Contains("\"market\"");
        }
        catch (Exception e)
        {
            lastError = e.Message;
            return false;
        }
    }

    static string lastError = "";

    // Cierra el servidor de Market (el de esta carpeta), lo haya iniciado esta vez o no.
    public static void StopServer()
    {
        if (home != null) KillOldServers();
    }

    public static void OpenBrowser()
    {
        try { Process.Start(Url); } catch { }
    }

    public static Icon AppIcon()
    {
        try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { return null; }
    }
}

/// Ventana principal: la vista de recepción dentro de WebView2.
class MainWindow : Form
{
    readonly WebView2 web;
    bool confirmed;

    public MainWindow()
    {
        Text = Program.Title;
        Icon = Program.AppIcon();
        BackColor = Color.FromArgb(11, 22, 64);
        MinimumSize = new Size(1000, 640);
        Size = new Size(1360, 860);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(238, 242, 250) };
        web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = Path.Combine(Program.home, "webview") };
        Controls.Add(web);
        web.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                MessageBox.Show("No se pudo abrir la vista de recepción. Se abrirá en el navegador.", "Market");
                Program.OpenBrowser();
                return;
            }
            CoreWebView2Settings st = web.CoreWebView2.Settings;
            st.AreDevToolsEnabled = false;
            st.IsStatusBarEnabled = false;
            st.AreBrowserAcceleratorKeysEnabled = true;
            // Los PDF (reporte del día, salidas) se abren en una ventana propia.
            web.CoreWebView2.NewWindowRequested += delegate(object o, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                new DocWindow(a.Uri).Show(this);
            };
            web.CoreWebView2.DocumentTitleChanged += delegate { };
        };
        web.Source = new Uri(Program.Url);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!confirmed && e.CloseReason == CloseReason.UserClosing)
        {
            var answer = MessageBox.Show(this,
                "Si cierras Market, las tablets no podrán enviar sus revisiones hasta que lo vuelvas a abrir.\n\n¿Cerrar Market?",
                "Cerrar Market", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes)
            {
                e.Cancel = true;
                return;
            }
            confirmed = true;
        }
        base.OnFormClosing(e);
    }
}

/// Ventana para un PDF u otra página que la vista abre aparte.
class DocWindow : Form
{
    public DocWindow(string uri)
    {
        Text = "Market";
        Icon = Program.AppIcon();
        Size = new Size(1000, 800);
        StartPosition = FormStartPosition.CenterParent;
        var web = new WebView2 { Dock = DockStyle.Fill };
        web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = Path.Combine(Program.home, "webview") };
        web.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess)
                web.CoreWebView2.DocumentTitleChanged += delegate { Text = web.CoreWebView2.DocumentTitle + " · Market"; };
        };
        Controls.Add(web);
        web.Source = new Uri(uri);
    }
}

/// Plan B sin WebView2: la vista en el navegador y un icono junto al reloj para cerrar Market.
static class Tray
{
    public static void Run()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir recepción", null, delegate { Program.OpenBrowser(); });
        menu.Items.Add(new ToolStripSeparator());
        var tray = new NotifyIcon { Icon = Program.AppIcon(), Text = "Market · desarrollado por Pirelix", ContextMenuStrip = menu, Visible = true };
        menu.Items.Add("Cerrar Market", null, delegate
        {
            tray.Visible = false;
            Application.Exit();
        });
        tray.DoubleClick += delegate { Program.OpenBrowser(); };
        Application.Run();
        tray.Visible = false;
    }
}

/// Ventanita mientras se instala e inicia.
class Splash : Form
{
    readonly Label label;

    public Splash()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(400, 170);
        BackColor = Color.FromArgb(11, 22, 64);
        ShowInTaskbar = true;
        Text = "Market";
        Icon = Program.AppIcon();
        var title = new Label
        {
            Text = "Market",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 20, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(28, 26),
        };
        label = new Label
        {
            Text = "Abriendo…",
            ForeColor = Color.FromArgb(199, 211, 245),
            Font = new Font("Segoe UI", 10),
            AutoSize = true,
            Location = new Point(30, 82),
        };
        var by = new Label
        {
            Text = "Desarrollado por Pirelix",
            ForeColor = Color.FromArgb(140, 160, 214),
            Font = new Font("Segoe UI", 8.5f),
            AutoSize = true,
            Location = new Point(30, 130),
        };
        var bar = new Panel { BackColor = Color.FromArgb(30, 64, 175), Dock = DockStyle.Bottom, Height = 5 };
        Controls.Add(title);
        Controls.Add(label);
        Controls.Add(by);
        Controls.Add(bar);
    }

    public void SetText(string text)
    {
        label.Text = text;
        Application.DoEvents();
    }
}
