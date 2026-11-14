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
[assembly: AssemblyVersion("1.0.2.0")]
[assembly: AssemblyFileVersion("1.0.2.0")]

static class Program
{
    public const string Title = "Market · Recepción";
    public const string Url = "http://127.0.0.1:4000/?rol=recepcion";
    const string Health = "http://127.0.0.1:4000/api/health";
    public static string home;
    static string testHome;
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
        // MARKET_HOME: solo para pruebas; instala en otra carpeta y no toca los accesos directos.
        testHome = Environment.GetEnvironmentVariable("MARKET_HOME");
        home = string.IsNullOrEmpty(testHome) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Market") : testHome;
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
        AppDialog.Show(null, "Market tuvo un error", "Se cerró por un error: " + (e == null ? "" : e.Message), "Cerrar", null, true);
        Environment.Exit(1);
    }

    static void Run()
    {
        var splash = new Splash();
        splash.Show();
        // Instalar y levantar el servidor va en segundo plano: así la pantalla de carga sigue
        // animada en vez de quedarse congelada.
        Exception failure = null;
        bool started = false;
        var worker = new Thread(() =>
        {
            try
            {
                Install(splash);
                Trace("instalado " + BuildInfo.Version);
                splash.SetStatus("Iniciando Market…", -1);
                started = IsUp() || StartServer();
            }
            catch (Exception ex)
            {
                failure = ex;
            }
        });
        worker.IsBackground = true;
        worker.SetApartmentState(ApartmentState.STA); // los accesos directos usan COM
        worker.Start();
        while (worker.IsAlive)
        {
            Application.DoEvents();
            Thread.Sleep(10);
        }
        if (failure != null)
        {
            splash.Close();
            AppDialog.Show(null, "Market no pudo prepararse", failure.Message, "Cerrar", null, true);
            return;
        }
        if (!started)
        {
            splash.Close();
            AppDialog.Show(null, "Market no pudo iniciar",
                "Puede que otro programa esté usando el puerto 4000. Detalle en " + LogPath(), "Cerrar", null, true);
            return;
        }
        splash.SetStatus("Abriendo recepción…", -1);

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
        splash.SetStatus("Instalando Market…", 0);
        KillOldServers();
        Directory.CreateDirectory(home);
        using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("market.zip"))
        using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
        {
            // El avance va por tamaño, no por número de archivos: Node solo pesa más que todo lo demás.
            long done = 0, total = 0;
            foreach (ZipArchiveEntry e in zip.Entries) total += e.Length;
            int lastPct = -1;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                done += e.Length;
                string name = e.FullName.Replace('\\', '/');
                if (name.StartsWith("Market/")) name = name.Substring(7);
                // Los datos del hotel nunca se reemplazan.
                if (name.Length == 0 || name.EndsWith("/") || name.StartsWith("server/data/")) continue;
                string dest = Path.Combine(home, name.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                int pct = total > 0 ? (int)(done * 100 / total) : 0;
                if (pct != lastPct)
                {
                    lastPct = pct;
                    splash.SetStatus("Instalando Market…", pct);
                }
            }
        }
        // Una copia del programa queda en la carpeta instalada: a ella apuntan los accesos directos.
        string self = Application.ExecutablePath;
        if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(ExeInHome()), StringComparison.OrdinalIgnoreCase))
            File.Copy(self, ExeInHome(), true);
        if (string.IsNullOrEmpty(testHome)) CreateShortcuts();
        File.WriteAllText(marker, BuildInfo.Version);
        splash.SetStatus("Instalando Market…", 100);
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

/// Ventana principal: la vista de recepción dentro de WebView2, con el marco de Market.
class MainWindow : AppFrame
{
    readonly WebView2 web;
    bool confirmed;

    public MainWindow() : base("Market", "Recepción")
    {
        Text = Program.Title; // así la encuentra un segundo doble clic, y así sale en la barra de tareas
        Icon = Program.AppIcon();
        MinimumSize = new Size(1000, 640);
        Size = new Size(1360, 860);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(238, 242, 250) };
        web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = Path.Combine(Program.home, "webview") };
        Body.Controls.Add(web);
        web.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                AppDialog.Show(this, "No se pudo abrir la vista", "Se abrirá en el navegador.", "Entendido", null, false);
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
        };
        web.Source = new Uri(Program.Url);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!confirmed && e.CloseReason == CloseReason.UserClosing)
        {
            bool yes = AppDialog.Show(this, "¿Cerrar Market?",
                "Si cierras Market, las tablets no podrán enviar sus revisiones hasta que lo vuelvas a abrir.",
                "Cerrar Market", "Seguir trabajando", true);
            if (!yes)
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
class DocWindow : AppFrame
{
    public DocWindow(string uri) : base("Documento", "Market")
    {
        Text = "Documento · Market";
        Icon = Program.AppIcon();
        Size = new Size(1000, 800);
        MinimumSize = new Size(520, 400);
        StartPosition = FormStartPosition.CenterParent;
        var web = new WebView2 { Dock = DockStyle.Fill };
        web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = Path.Combine(Program.home, "webview") };
        web.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess)
                web.CoreWebView2.DocumentTitleChanged += delegate { SetTitle(web.CoreWebView2.DocumentTitle, "Market"); };
        };
        Body.Controls.Add(web);
        web.Source = new Uri(uri);
    }
}

/// Colores de Market.
static class Palette
{
    public static readonly Color Navy = Color.FromArgb(11, 22, 64);
    public static readonly Color NavyHover = Color.FromArgb(28, 42, 99);
    public static readonly Color Brand = Color.FromArgb(30, 64, 175);
    public static readonly Color Muted = Color.FromArgb(142, 156, 196);
    public static readonly Color Page = Color.FromArgb(238, 242, 250);
    public static readonly Color Ink = Color.FromArgb(15, 23, 42);
    public static readonly Color Body = Color.FromArgb(71, 85, 105);
    public static readonly Color Line = Color.FromArgb(220, 227, 241);
    public static readonly Color Danger = Color.FromArgb(220, 53, 69);
}

/// Marco propio de Market en lugar del de Windows: barra azul noche con el logo, el título y
/// los botones de minimizar, maximizar y cerrar. Se arrastra desde la barra, doble clic
/// maximiza, se cambia el tamaño desde los bordes y en Windows 11 tiene esquinas redondeadas.
class AppFrame : Form
{
    const int WM_NCLBUTTONDOWN = 0xA1, WM_NCHITTEST = 0x84;
    const int HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
    const int GRIP = 6;

    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);

    protected readonly Panel Body;
    readonly Panel bar;
    readonly TitleButton max;
    string title, subtitle;

    public AppFrame(string title, string subtitle)
    {
        this.title = title;
        this.subtitle = subtitle;
        FormBorderStyle = FormBorderStyle.None;
        DoubleBuffered = true;
        BackColor = Palette.Page;
        Font = new Font("Segoe UI", 9f);

        bar = new Panel { Dock = DockStyle.Top, Height = 40, BackColor = Palette.Navy };
        bar.Paint += PaintBar;
        bar.MouseDown += BarMouseDown;
        bar.MouseMove += BarMouseMove;
        bar.DoubleClick += delegate { ToggleMax(); };

        var close = new TitleButton(TitleButton.Kind.Close);
        max = new TitleButton(TitleButton.Kind.Maximize);
        var min = new TitleButton(TitleButton.Kind.Minimize);
        close.Click += delegate { Close(); };
        max.Click += delegate { ToggleMax(); };
        min.Click += delegate { WindowState = FormWindowState.Minimized; };
        // Con Dock a la derecha, el último que se agrega queda en la orilla: así cerrar queda
        // a la derecha del todo, como en Windows (minimizar, maximizar, cerrar).
        foreach (Control c in new Control[] { min, max, close })
        {
            c.Dock = DockStyle.Right;
            bar.Controls.Add(c);
        }

        Body = new Panel { Dock = DockStyle.Fill, BackColor = Palette.Page };
        Controls.Add(Body);
        Controls.Add(bar);
        UpdateEdges();
    }

    public void SetTitle(string t, string sub)
    {
        title = string.IsNullOrEmpty(t) ? title : t;
        subtitle = sub;
        bar.Invalidate();
    }

    // Sombra, y que la barra de tareas pueda minimizar y restaurar aunque no haya marco de Windows.
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
            cp.Style |= 0x20000 | 0x10000 | 0x80000; // WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int round = 2; // DWMWCP_ROUND (Windows 11; en Windows 10 no hace nada)
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        }
        catch { }
        FitMaximized();
    }

    // Al maximizar no debe tapar la barra de tareas de Windows.
    void FitMaximized()
    {
        Screen sc = Screen.FromHandle(Handle);
        Rectangle wa = sc.WorkingArea, b = sc.Bounds;
        MaximizedBounds = new Rectangle(wa.X - b.X, wa.Y - b.Y, wa.Width, wa.Height);
    }

    protected override void OnLocationChanged(EventArgs e)
    {
        base.OnLocationChanged(e);
        if (IsHandleCreated && WindowState != FormWindowState.Maximized) FitMaximized();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        UpdateEdges();
    }

    // Unos píxeles de borde para poder agarrar la ventana y cambiarle el tamaño.
    void UpdateEdges()
    {
        bool maxed = WindowState == FormWindowState.Maximized;
        Padding = maxed ? Padding.Empty : new Padding(4, 0, 4, 4);
        if (max != null) max.Restore = maxed;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        // Borde izquierdo del color del menú, el resto del color de la página, y una línea fina.
        using (var navy = new SolidBrush(Palette.Navy)) e.Graphics.FillRectangle(navy, 0, 0, Padding.Left, Height);
        if (WindowState != FormWindowState.Maximized)
            using (var line = new Pen(Color.FromArgb(40, 52, 96))) e.Graphics.DrawRectangle(line, 0, 0, Width - 1, Height - 1);
    }

    void ToggleMax()
    {
        FitMaximized();
        WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
    }

    void BarMouseDown(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left || e.Clicks > 1) return;
        int ht = HTCAPTION;
        if (WindowState != FormWindowState.Maximized && e.Y < GRIP) ht = e.X < GRIP * 2 ? HTTOPLEFT : e.X > bar.Width - GRIP * 2 ? HTTOPRIGHT : HTTOP;
        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)ht, IntPtr.Zero);
    }

    void BarMouseMove(object sender, MouseEventArgs e)
    {
        bar.Cursor = WindowState != FormWindowState.Maximized && e.Y < GRIP ? Cursors.SizeNS : Cursors.Default;
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != WM_NCHITTEST || WindowState == FormWindowState.Maximized) return;
        long lp = m.LParam.ToInt64();
        Point p = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
        bool left = p.X < GRIP, right = p.X >= Width - GRIP, top = p.Y < GRIP, bottom = p.Y >= Height - GRIP;
        int ht = 0;
        if (top && left) ht = HTTOPLEFT;
        else if (top && right) ht = HTTOPRIGHT;
        else if (bottom && left) ht = HTBOTTOMLEFT;
        else if (bottom && right) ht = HTBOTTOMRIGHT;
        else if (left) ht = HTLEFT;
        else if (right) ht = HTRIGHT;
        else if (top) ht = HTTOP;
        else if (bottom) ht = HTBOTTOM;
        if (ht != 0) m.Result = (IntPtr)ht;
    }

    void PaintBar(object sender, PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        // Logo: cuadrado azul rey con la puerta.
        var logo = new Rectangle(14, 9, 22, 22);
        using (var path = RoundRect(logo, 6))
        using (var brand = new SolidBrush(Palette.Brand))
            g.FillPath(brand, path);
        using (var pen = new Pen(Color.White, 1.6f))
        using (var door = RoundRect(new Rectangle(21, 14, 8, 12), 1))
            g.DrawPath(pen, door);
        using (var knob = new SolidBrush(Color.White)) g.FillEllipse(knob, 26.2f, 19.6f, 2f, 2f);
        // Título y subtítulo.
        using (var titleFont = new Font("Segoe UI Semibold", 10f))
        using (var subFont = new Font("Segoe UI", 9f))
        using (var white = new SolidBrush(Color.White))
        using (var muted = new SolidBrush(Palette.Muted))
        {
            float x = 46;
            SizeF ts = g.MeasureString(title, titleFont);
            g.DrawString(title, titleFont, white, x, (bar.Height - ts.Height) / 2f);
            if (!string.IsNullOrEmpty(subtitle))
            {
                x += ts.Width + 2;
                string sub = "·  " + subtitle;
                SizeF ss = g.MeasureString(sub, subFont);
                g.DrawString(sub, subFont, muted, x, (bar.Height - ss.Height) / 2f + 0.5f);
            }
        }
    }

    public static System.Drawing.Drawing2D.GraphicsPath RoundRect(Rectangle r, int radius)
    {
        int d = radius * 2;
        var p = new System.Drawing.Drawing2D.GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

/// Botón de la barra de título, dibujado con líneas finas; el de cerrar se pone rojo.
class TitleButton : Button
{
    public enum Kind { Minimize, Maximize, Close }
    readonly Kind kind;
    bool hover, down, restore;

    public bool Restore
    {
        get { return restore; }
        set { restore = value; Invalidate(); }
    }

    public TitleButton(Kind kind)
    {
        this.kind = kind;
        Width = 46;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false;
        FlatStyle = FlatStyle.Flat;
        BackColor = Palette.Navy;
        Text = kind == Kind.Close ? "Cerrar" : kind == Kind.Minimize ? "Minimizar" : "Maximizar";
        AccessibleName = Text;
        AccessibleRole = AccessibleRole.PushButton; // dibujado a mano: se avisa que es un botón
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        Color bg = Palette.Navy;
        if (hover) bg = kind == Kind.Close ? (down ? Color.FromArgb(185, 40, 55) : Palette.Danger) : (down ? Color.FromArgb(38, 56, 122) : Palette.NavyHover);
        using (var b = new SolidBrush(bg)) g.FillRectangle(b, ClientRectangle);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        float cx = Width / 2f, cy = Height / 2f;
        using (var pen = new Pen(hover ? Color.White : Color.FromArgb(200, 210, 236), 1.25f))
        {
            if (kind == Kind.Minimize) g.DrawLine(pen, cx - 5, cy + 0.5f, cx + 5, cy + 0.5f);
            else if (kind == Kind.Close)
            {
                g.DrawLine(pen, cx - 5, cy - 5, cx + 5, cy + 5);
                g.DrawLine(pen, cx + 5, cy - 5, cx - 5, cy + 5);
            }
            else if (!restore)
            {
                using (var r = AppFrame.RoundRect(new Rectangle((int)cx - 5, (int)cy - 5, 10, 10), 2)) g.DrawPath(pen, r);
            }
            else
            {
                using (var back = AppFrame.RoundRect(new Rectangle((int)cx - 3, (int)cy - 6, 9, 9), 2)) g.DrawPath(pen, back);
                using (var cover = new SolidBrush(bg)) g.FillRectangle(cover, (int)cx - 6, (int)cy - 3, 10, 10);
                using (var front = AppFrame.RoundRect(new Rectangle((int)cx - 6, (int)cy - 3, 9, 9), 2)) g.DrawPath(pen, front);
            }
        }
    }
}

/// Diálogo con el estilo de Market (en lugar del cuadro gris de Windows).
class AppDialog : Form
{
    bool result;

    public static bool Show(IWin32Window owner, string title, string text, string confirm, string cancel, bool danger)
    {
        using (var d = new AppDialog(title, text, confirm, cancel, danger))
        {
            d.ShowDialog(owner);
            return d.result;
        }
    }

    AppDialog(string title, string text, string confirm, string cancel, bool danger)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        BackColor = Color.White;
        Size = new Size(440, 210);
        Font = new Font("Segoe UI", 10f);
        Text = title;

        var accent = new Panel { Dock = DockStyle.Top, Height = 5, BackColor = danger ? Palette.Danger : Palette.Brand };
        var head = new Label { Text = title, Font = new Font("Segoe UI Semibold", 14f), ForeColor = Palette.Ink, AutoSize = true, Location = new Point(26, 26) };
        var body = new Label { Text = text, ForeColor = Palette.Body, Location = new Point(28, 66), Size = new Size(390, 60) };
        var ok = new FlatButton(confirm, danger ? Palette.Danger : Palette.Brand, Color.White) { Location = new Point(cancel == null ? 266 : 266, 150) };
        ok.Click += delegate { result = true; Close(); };
        Controls.Add(accent);
        Controls.Add(head);
        Controls.Add(body);
        Controls.Add(ok);
        if (cancel != null)
        {
            var no = new FlatButton(cancel, Color.White, Palette.Ink) { Location = new Point(106, 150) };
            no.Border = Palette.Line;
            no.Click += delegate { result = false; Close(); };
            Controls.Add(no);
            CancelButton = no; // Escape
            ActiveControl = no; // por defecto, no cerrar
        }
        else CancelButton = ok;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ClassStyle |= 0x20000; // sombra
            return cp;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using (var p = new Pen(Palette.Line)) e.Graphics.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
    }
}

/// Botón plano redondeado.
class FlatButton : Button
{
    readonly Color fill, fore;
    public Color Border = Color.Empty;
    bool hover;

    public FlatButton(string text, Color fill, Color fore)
    {
        Text = text;
        this.fill = fill;
        this.fore = fore;
        Size = new Size(150, 40);
        Cursor = Cursors.Hand;
        Font = new Font("Segoe UI Semibold", 10f);
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        FlatStyle = FlatStyle.Flat;
        BackColor = Color.White;
        TabStop = true;
        AccessibleName = text;
        AccessibleRole = AccessibleRole.PushButton; // dibujado a mano: se avisa que es un botón
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Color.White);
        Color c = fill;
        if (hover) c = fill == Color.White ? Color.FromArgb(244, 246, 251) : ControlPaint.Dark(fill, 0.08f);
        var r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = AppFrame.RoundRect(r, 9))
        {
            using (var b = new SolidBrush(c)) g.FillPath(b, path);
            if (Border != Color.Empty) using (var p = new Pen(Border)) g.DrawPath(p, path);
            if (Focused) using (var p = new Pen(Palette.Brand, 2f)) g.DrawPath(p, path);
        }
        TextRenderer.DrawText(g, Text, Font, r, fore, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
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

/// Pantalla de carga mientras se instala e inicia: aparece suavemente, el logo late despacio
/// y abajo corre una barra (con el porcentaje real mientras instala).
class Splash : Form
{
    readonly System.Windows.Forms.Timer timer;
    readonly DateTime started = DateTime.Now;
    string status = "Abriendo…";
    int percent = -1; // -1: sin porcentaje, la barra se desliza
    float shown;      // porcentaje dibujado, se acerca suave al real

    public Splash()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(460, 220);
        BackColor = Palette.Navy;
        ShowInTaskbar = true;
        TopMost = true; // que no quede escondida detrás de otra ventana mientras carga
        Text = "Market";
        Icon = Program.AppIcon();
        Opacity = 0;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        timer = new System.Windows.Forms.Timer { Interval = 16 };
        timer.Tick += delegate
        {
            if (Opacity < 1) Opacity = Math.Min(1, Opacity + 0.08);
            if (percent >= 0) shown += (percent - shown) * 0.15f;
            Invalidate();
        };
        timer.Start();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ClassStyle |= 0x20000; // sombra
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int round = 2; // esquinas redondeadas en Windows 11
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        }
        catch { }
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);

    /// Se puede llamar desde cualquier hilo.
    public void SetStatus(string text, int pct)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(new Action(() => SetStatus(text, pct))); } catch { }
            return;
        }
        if (pct >= 0 && percent < 0) shown = 0;
        status = text;
        percent = pct;
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        timer.Stop();
        base.OnFormClosed(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Palette.Navy);
        double t = (DateTime.Now - started).TotalSeconds;

        // Brillo suave detrás del logo, que late despacio.
        float pulse = (float)(0.5 + 0.5 * Math.Sin(t * 2.4));
        var logo = new Rectangle(32, 36, 52, 52);
        for (int i = 3; i >= 1; i--)
        {
            int grow = (int)(i * 5 + pulse * 4);
            using (var glow = new SolidBrush(Color.FromArgb((int)(18 + pulse * 14) / i, 76, 125, 255)))
            using (var gp = AppFrame.RoundRect(Rectangle.Inflate(logo, grow, grow), 14 + grow / 2))
                g.FillPath(glow, gp);
        }
        using (var gp = AppFrame.RoundRect(logo, 14))
        using (var brand = new System.Drawing.Drawing2D.LinearGradientBrush(logo, Color.FromArgb(52, 92, 214), Palette.Brand, 90f))
            g.FillPath(brand, gp);
        using (var pen = new Pen(Color.White, 2.4f))
        using (var door = AppFrame.RoundRect(new Rectangle(logo.X + 18, logo.Y + 12, 17, 28), 2))
            g.DrawPath(pen, door);
        using (var knob = new SolidBrush(Color.White)) g.FillEllipse(knob, logo.X + 28.5f, logo.Y + 25.5f, 3.6f, 3.6f);

        // Nombre.
        using (var titleFont = new Font("Segoe UI", 22f, FontStyle.Bold))
        using (var subFont = new Font("Segoe UI", 10f))
        using (var white = new SolidBrush(Color.White))
        using (var muted = new SolidBrush(Color.FromArgb(159, 176, 220)))
        {
            g.DrawString("Market", titleFont, white, 100, 32);
            g.DrawString("Minibar · Recepción", subFont, muted, 104, 72);
        }

        // Estado, con puntos que aparecen uno a uno.
        string dots = new string('.', (int)(t * 2.5) % 4);
        string text = status.TrimEnd('…', '.') + (percent >= 0 ? "  " + percent + "%" : dots);
        using (var f = new Font("Segoe UI", 10f))
        using (var b = new SolidBrush(Color.FromArgb(199, 211, 245)))
            g.DrawString(text, f, b, 32, 122);

        // Barra de progreso.
        var track = new Rectangle(34, 152, Width - 68, 6);
        using (var tp = AppFrame.RoundRect(track, 3))
        using (var tb = new SolidBrush(Color.FromArgb(28, 42, 99)))
            g.FillPath(tb, tp);
        Region old = g.Clip;
        using (var tp = AppFrame.RoundRect(track, 3))
        {
            g.SetClip(tp);
            RectangleF fill;
            if (percent >= 0) fill = new RectangleF(track.X, track.Y, track.Width * Math.Max(0.02f, shown / 100f), track.Height);
            else
            {
                // Franja que se desliza de lado a lado, más rápida en el centro.
                double phase = (t * 0.75) % 1.0;
                double eased = 0.5 - 0.5 * Math.Cos(phase * Math.PI);
                float w = track.Width * 0.32f;
                fill = new RectangleF((float)(track.X - w + (track.Width + w) * eased), track.Y, w, track.Height);
            }
            if (fill.Width > 0)
                using (var fb = new System.Drawing.Drawing2D.LinearGradientBrush(new RectangleF(fill.X - 1, fill.Y, fill.Width + 2, fill.Height), Color.FromArgb(76, 125, 255), Color.FromArgb(140, 172, 255), 0f))
                    g.FillRectangle(fb, fill);
        }
        g.Clip = old;

        // Firma: "Desarrollado por" normal y "Pirelix" en negrita.
        using (var f = new Font("Segoe UI", 9f))
        using (var fb = new Font("Segoe UI", 9f, FontStyle.Bold))
        using (var muted = new SolidBrush(Color.FromArgb(140, 160, 214)))
        using (var strong = new SolidBrush(Color.White))
        {
            const string by = "Desarrollado por ";
            var flags = TextFormatFlags.NoPadding | TextFormatFlags.Left;
            Size sz = TextRenderer.MeasureText(g, by, f, Size.Empty, flags);
            TextRenderer.DrawText(g, by, f, new Point(33, 182), muted.Color, flags);
            TextRenderer.DrawText(g, "Pirelix", fb, new Point(33 + sz.Width, 182), strong.Color, flags);
        }

        // Borde fino.
        using (var line = new Pen(Color.FromArgb(40, 52, 96))) g.DrawRectangle(line, 0, 0, Width - 1, Height - 1);
    }
}
