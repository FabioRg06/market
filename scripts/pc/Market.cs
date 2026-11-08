// Market.exe: un solo archivo para el PC de recepción.
// Trae adentro (como recurso) el zip con Node portátil, el servidor y la vista de recepción.
// Al abrirlo: lo instala en %LOCALAPPDATA%\Market (solo la primera vez o si cambió la versión,
// sin tocar los datos), levanta el servidor sin ventanas, abre el navegador en la vista de
// recepción y queda un icono junto al reloj para abrirla de nuevo o cerrar Market.
// Se compila con el csc.exe de .NET Framework 4 (C# 5), desde scripts/empaquetar-pc.mjs.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    const string Url = "http://localhost:4000/?rol=recepcion";
    const string Health = "http://localhost:4000/api/health";
    static Process server;
    static string home;

    [STAThread]
    static void Main()
    {
        bool first;
        var mutex = new Mutex(true, "Market.Recepcion", out first);
        if (!first)
        {
            // Ya está abierto: solo se muestra la vista de recepción.
            OpenBrowser();
            return;
        }
        Application.EnableVisualStyles();
        home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Market");
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Fail(e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Fail(e.ExceptionObject as Exception); };
        try
        {
            Run(mutex);
        }
        catch (Exception e)
        {
            Fail(e);
        }
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

    static void Run(Mutex mutex)
    {
        var splash = new Splash();
        splash.Show();
        Application.DoEvents();
        try
        {
            Install(splash);
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
        splash.Close();
        OpenBrowser();
        RunTray();
        StopServer();
        GC.KeepAlive(mutex);
    }

    // ---------- Instalación ----------

    static string Version()
    {
        return BuildInfo.Version;
    }

    static void Install(Splash splash)
    {
        string marker = Path.Combine(home, "version.txt");
        if (File.Exists(marker) && File.ReadAllText(marker).Trim() == Version()) return;
        splash.SetText("Preparando Market por primera vez…");
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
                if (done % 100 == 0) splash.SetText("Preparando Market por primera vez… " + (done * 100 / total) + "%");
            }
        }
        File.WriteAllText(marker, Version());
    }

    // Un servidor viejo de esta misma carpeta tendría bloqueados los archivos.
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
        // Un servidor viejo colgado tendría ocupado el puerto.
        KillOldServers();
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
        for (int i = 0; i < 80; i++)
        {
            if (server.HasExited) return false;
            if (IsUp()) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    static bool IsUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Health);
            req.Proxy = null;
            req.Timeout = 800;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream()))
                return r.ReadToEnd().Contains("\"market\"");
        }
        catch
        {
            return false;
        }
    }

    // Cierra el servidor de Market (el de esta carpeta), lo haya iniciado esta vez o no.
    static void StopServer()
    {
        if (home != null) KillOldServers();
    }

    static void OpenBrowser()
    {
        try { Process.Start(Url); } catch { }
    }

    // ---------- Icono junto al reloj ----------

    static void RunTray()
    {
        var menu = new ContextMenuStrip();
        var open = menu.Items.Add("Abrir recepción", null, delegate { OpenBrowser(); });
        open.Font = new Font(open.Font, FontStyle.Bold);
        menu.Items.Add("Excel de ejemplo de salidas", null, delegate
        {
            try { Process.Start("explorer.exe", "/select,\"" + Path.Combine(home, "Ejemplo de salidas.xlsx") + "\""); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        var tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "Market · recepción",
            ContextMenuStrip = menu,
            Visible = true,
        };
        menu.Items.Add("Cerrar Market", null, delegate
        {
            tray.Visible = false;
            Application.Exit();
        });
        tray.DoubleClick += delegate { OpenBrowser(); };
        if (server != null)
            tray.ShowBalloonTip(5000, "Market está abierto",
                "Las tablets de esta red lo encuentran solas. Para cerrarlo, usa este icono.", ToolTipIcon.Info);
        // Si el servidor se cae, se avisa y se cierra el icono.
        if (server != null)
        {
            server.EnableRaisingEvents = true;
            server.Exited += delegate
            {
                tray.Visible = false;
                Application.Exit();
            };
        }
        Application.Run();
        tray.Visible = false;
    }
}

/// Ventanita mientras se prepara e inicia.
class Splash : Form
{
    readonly Label label;

    public Splash()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(380, 150);
        BackColor = Color.FromArgb(11, 22, 64);
        ShowInTaskbar = true;
        Text = "Market";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
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
        var bar = new Panel { BackColor = Color.FromArgb(30, 64, 175), Dock = DockStyle.Bottom, Height = 5 };
        Controls.Add(title);
        Controls.Add(label);
        Controls.Add(bar);
    }

    public void SetText(string text)
    {
        label.Text = text;
        Application.DoEvents();
    }
}
