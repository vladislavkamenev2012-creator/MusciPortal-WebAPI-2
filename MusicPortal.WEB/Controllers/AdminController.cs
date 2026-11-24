using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MusicPortal.WEB.Controllers
{
    /// <summary>
    /// Отдаёт единственную страницу админ-SPA. Все данные загружаются и изменяются
    /// на клиенте через Web API (/api/users, /api/artists, /api/genres) с помощью Fetch API.
    /// </summary>
    [Authorize(Roles = "Admin")]
    public class AdminController : Controller
    {
        public IActionResult Index() => View();
    }
}
