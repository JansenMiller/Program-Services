'use strict';
// The shortcut registry. To add a new tool: add an entry here and put its page under public/tools/<id>/.
// The server enforces `roles` on every request to the tool's path -- hiding a link is not the only protection.
const ROLES = ['supervisor', 'caseworker', 'chaplain'];

const TOOLS = [
  {
    id: 'certificates', name: 'Certificate of Completion', status: 'live', href: '/tools/certificates/',
    description: 'Fill in a few details and print a Certificate of Completion for a program participant.',
    roles: ['caseworker', 'supervisor'],
  },
  {
    id: 'chapel-calendar', name: 'Chapel & Classroom Calendar', status: 'soon', href: '/tools/chapel-calendar/',
    description: 'Build and print chapel and classroom calendars for your facility.',
    roles: ['chaplain', 'supervisor'],
  },
  {
    id: 'ideas', name: 'Shortcut Ideas', status: 'live', href: '/ideas.html',
    description: 'Tell Program Services about a time-consuming task you would like a shortcut for.',
    roles: ROLES,
  },
  {
    id: 'users', name: 'Manage Team', status: 'live', href: '/admin/users.html',
    description: 'Add staff, assign roles, reset passwords, and turn accounts off.',
    roles: ['supervisor'],
  },
];

const toolsFor = (role) => TOOLS.filter((t) => t.roles.includes(role));

// Which roles may load this path? null = any signed-in user.
function rolesForPath(p) {
  if (p.startsWith('/admin/')) return ['supervisor'];
  if (p.startsWith('/tools/')) {
    const t = TOOLS.find((x) => p.startsWith(x.href));
    return t ? t.roles : []; // unknown tool folder: nobody
  }
  return null;
}

module.exports = { ROLES, TOOLS, toolsFor, rolesForPath };
