import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, CloudUpload, Mail, Share2, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import type { MemberRole, TeamMemberSummary, TeamSummary } from '../domain/preset';
import {
  listCloudPendingInvitations,
  listCloudTeamMembers,
  removeCloudTeamMember,
  revokeCloudInvitation,
  updateCloudMemberRole,
  type TeamInvitationSummary,
} from '../lib/cloudRepository';

export type TeamModalMode = 'create' | 'invite' | 'join' | 'manage';

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector (solo lectura)',
};

export function TeamWorkspaceModal({
  mode,
  team,
  isCloudUser,
  localCustomCount,
  onClose,
  onCreate,
  onInvite,
  onAccept,
  onSyncLocalToCloud,
  onOpenCloudSettings,
  onTeamsReloaded,
}: {
  mode: TeamModalMode;
  team?: TeamSummary;
  isCloudUser: boolean;
  localCustomCount: number;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onInvite: (email: string) => Promise<string>;
  onAccept: (code: string) => Promise<void>;
  onSyncLocalToCloud: () => Promise<void>;
  onOpenCloudSettings: () => void;
  onTeamsReloaded?: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncingLocal, setSyncingLocal] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitationSummary[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'manage' || !isCloudUser || !team?.id) return;
    let active = true;
    setLoadingMembers(true);
    Promise.all([listCloudTeamMembers(team.id), listCloudPendingInvitations(team.id)])
      .then(([loadedMembers, loadedInvites]) => {
        if (!active) return;
        setMembers(loadedMembers);
        setInvitations(loadedInvites);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los miembros del equipo.');
        }
      })
      .finally(() => {
        if (active) setLoadingMembers(false);
      });
    return () => {
      active = false;
    };
  }, [mode, isCloudUser, team?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'create') await onCreate(name);
      if (mode === 'invite' || mode === 'manage') {
        const generated = await onInvite(email);
        setInviteCode(generated);
        setEmail('');
        if (team?.id && isCloudUser) {
          setInvitations(await listCloudPendingInvitations(team.id));
        }
      }
      if (mode === 'join') await onAccept(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(memberUserId: string, nextRole: MemberRole) {
    if (!team) return;
    setError('');
    try {
      await updateCloudMemberRole(team.id, memberUserId, nextRole);
      setMembers((current) =>
        current.map((member) => (member.userId === memberUserId ? { ...member, role: nextRole } : member))
      );
      setMessage('Rol actualizado correctamente.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el rol del miembro.');
    }
  }

  async function handleRemoveMember(member: TeamMemberSummary) {
    if (!team) return;
    setError('');
    try {
      await removeCloudTeamMember(team.id, member.userId);
      if (member.isSelf) {
        if (onTeamsReloaded) await onTeamsReloaded();
        onClose();
        return;
      }
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
      setMessage(`Se quitó a ${member.displayName} del equipo.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo quitar al miembro.');
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    setError('');
    try {
      await revokeCloudInvitation(invitationId);
      setInvitations((current) => current.filter((inv) => inv.id !== invitationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo revocar la invitación.');
    }
  }

  async function handleMigrateLocal() {
    setSyncingLocal(true);
    setError('');
    setMessage('');
    try {
      await onSyncLocalToCloud();
      setMessage('Tus presets locales se subieron al equipo en la nube.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron subir los presets locales.');
    } finally {
      setSyncingLocal(false);
    }
  }

  const title =
    mode === 'create'
      ? 'Crea un espacio de equipo'
      : mode === 'invite'
        ? 'Invita a tu equipo'
        : mode === 'join'
          ? 'Únete con un código'
          : `Equipo · ${team?.name ?? 'Espacio activo'}`;

  const canInviteOrEdit = (team?.role ?? 'owner') !== 'viewer';
  const isOwner = team?.role === 'owner';

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal-panel ${mode === 'manage' ? 'team-manage-modal' : 'team-modal'}`}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <div>
            <div className="eyebrow">ESPACIOS COMPARTIDOS</div>
            <h2>{title}</h2>
            <p>
              {mode === 'create'
                ? 'Organiza presets, versiones y recursos para editar en equipo.'
                : mode === 'invite'
                  ? `Crea un código privado para compartir “${team?.name ?? 'tu equipo'}”.`
                  : mode === 'join'
                    ? 'El código solo funciona con el correo al que se envió la invitación.'
                    : 'Gestiona miembros, permisos de edición, invitaciones y sincronización de catálogo.'}
            </p>
          </div>
          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>

        {mode === 'manage' ? (
          <div className="team-manage-body">
            <div className="settings-card">
              <div className="settings-card-head">
                <h3>Miembros y permisos</h3>
                <span className={`status-pill${isCloudUser ? ' status-pill-ok' : ''}`}>
                  {isCloudUser ? 'Sincronizado en nube' : 'Espacio local'}
                </span>
              </div>

              {!isCloudUser ? (
                <>
                  <div className="member-list">
                    <div className="member-row">
                      <div className="member-info">
                        <span className="team-avatar">T</span>
                        <div>
                          <strong>Tú (Estudio local)</strong>
                          <small>Acceso total en esta computadora</small>
                        </div>
                      </div>
                      <span className="role-badge">Propietario</span>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    Para invitar editores, asignar roles (Propietario, Editor, Lector) y compartir presets entre varias
                    estaciones de trabajo, conecta tu proyecto Supabase.
                  </p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => {
                        onClose();
                        onOpenCloudSettings();
                      }}
                    >
                      <Users size={14} /> Configurar Supabase para equipos
                    </button>
                  </div>
                </>
              ) : loadingMembers ? (
                <div className="sync-ribbon">
                  <span className="sync-spinner" /> Cargando miembros del equipo...
                </div>
              ) : (
                <div className="member-list">
                  {members.map((member) => (
                    <div key={member.userId} className="member-row">
                      <div className="member-info">
                        <span className="team-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>
                            {member.displayName} {member.isSelf ? '(Tú)' : ''}
                          </strong>
                          <small>Miembro desde {new Date(member.joinedAt).toLocaleDateString('es-ES')}</small>
                        </div>
                      </div>
                      <div className="member-actions">
                        {isOwner && !member.isSelf ? (
                          <select
                            className="member-role-select"
                            aria-label={`Rol de ${member.displayName}`}
                            value={member.role}
                            onChange={(event) => void handleRoleChange(member.userId, event.target.value as MemberRole)}
                          >
                            <option value="owner">Propietario</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Lector</option>
                          </select>
                        ) : (
                          <span className="role-badge">
                            <ShieldCheck size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                            {ROLE_LABELS[member.role]}
                          </span>
                        )}
                        {((isOwner && !member.isSelf) || (member.isSelf && member.role !== 'owner')) && (
                          <button
                            type="button"
                            className="icon-button"
                            title={member.isSelf ? 'Salir del equipo' : `Quitar a ${member.displayName}`}
                            aria-label={member.isSelf ? 'Salir del equipo' : `Quitar a ${member.displayName}`}
                            onClick={() => void handleRemoveMember(member)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isCloudUser && canInviteOrEdit && (
              <div className="settings-card">
                <div className="settings-card-head">
                  <h3>Invitar colaboradores</h3>
                  <span className="status-pill">Caduca en 7 días</span>
                </div>
                <form onSubmit={submit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <div className="input-with-icon" style={{ flex: 1, minWidth: '210px' }}>
                    <Mail size={15} />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      placeholder="editor@estudio.com"
                      style={{
                        width: '100%',
                        minHeight: '38px',
                        padding: '8px 11px 8px 34px',
                        color: 'var(--ink)',
                        border: '1px solid var(--line-bright)',
                        borderRadius: '7px',
                        background: '#0b0e18',
                        fontSize: '12.5px',
                      }}
                    />
                  </div>
                  <button type="submit" className="button-primary" disabled={busy}>
                    {busy ? 'Generando...' : 'Generar código'}
                  </button>
                </form>

                {inviteCode && (
                  <div className="editor-path-item" style={{ borderColor: 'rgba(34, 211, 238, 0.45)' }}>
                    <strong>Código listo: {inviteCode}</strong>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={async () => {
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(inviteCode);
                            setCopied(true);
                          }
                        }}
                      >
                        <Share2 size={13} /> {copied ? 'Copiado' : 'Copiar código'}
                      </button>
                    </div>
                  </div>
                )}

                {invitations.length > 0 && (
                  <div className="member-list">
                    {invitations.map((inv) => (
                      <div key={inv.id} className="member-row">
                        <div className="member-info">
                          <div>
                            <strong>{inv.email}</strong>
                            <small>Expira el {new Date(inv.expiresAt).toLocaleDateString('es-ES')}</small>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Revocar invitación para ${inv.email}`}
                          onClick={() => void handleRevokeInvite(inv.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isCloudUser && canInviteOrEdit && (
              <div className="settings-card">
                <div className="settings-card-head">
                  <h3>Migrar presets locales al equipo</h3>
                  <span className="status-pill">{localCustomCount} locales</span>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>
                  Sube en un clic los presets creados o importados en tu biblioteca local para que todo el equipo pueda
                  usarlos.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={syncingLocal || localCustomCount === 0}
                    onClick={() => void handleMigrateLocal()}
                  >
                    <CloudUpload size={15} />
                    {syncingLocal ? 'Subiendo al equipo...' : 'Subir presets locales al equipo'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </div>
        ) : inviteCode ? (
          <div className="invite-result">
            <div className="success-mark">
              <Check size={18} />
            </div>
            <h3>Invitación lista</h3>
            <p>Comparte este código con la persona invitada. Caduca en 7 días.</p>
            <code>{inviteCode}</code>
            <button
              className="button-primary"
              type="button"
              onClick={async () => {
                try {
                  if (!navigator.clipboard) throw new Error('El navegador no permite copiar automáticamente.');
                  await navigator.clipboard.writeText(inviteCode);
                  setCopied(true);
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'No se pudo copiar el código.');
                }
              }}
            >
              <Share2 size={15} />
              {copied ? 'Código copiado' : 'Copiar código'}
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form className="team-form" onSubmit={submit}>
            {mode === 'create' && (
              <label className="field-label">
                Nombre del equipo
                <input
                  autoFocus
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  placeholder="Ej. Estudio Norte"
                />
              </label>
            )}
            {mode === 'invite' && (
              <label className="field-label">
                Correo de la persona
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  placeholder="alguien@estudio.com"
                />
              </label>
            )}
            {mode === 'join' && (
              <label className="field-label">
                Código de invitación
                <input
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  required
                  maxLength={24}
                  placeholder="24 caracteres"
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="button-primary" disabled={busy}>
                {busy
                  ? 'Procesando...'
                  : mode === 'create'
                    ? 'Crear equipo'
                    : mode === 'invite'
                      ? 'Generar invitación'
                      : 'Unirme'}
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
