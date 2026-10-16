import {t} from './lib/i18n';
import {Badge} from '@/components/ui/badge';

export const stateNames=():Record<string,string>=>({prepared:t("Preparada"),active:t("En curso"),paused:t("Pausada"),blocked:t("Bloqueada"),recovery_required:t("Requiere recuperación"),completed:t("Finalizada"),cancelled:t("Cancelada"),limit_reached:t("Límite alcanzado")});
export const providerName=(provider:string)=>provider==='codex'?'Codex':provider==='claude'?'Claude':provider;
// Color carries meaning only: green is running, orange waits on someone, red needs a fix; finished states stay neutral.
const tone=(state:string)=>state==='active'?'success':state==='paused'||state==='prepared'?'warning':state==='blocked'||state==='recovery_required'?'danger':'neutral';
const tones:Record<string,[string,string]>={success:['border-success/30 bg-success/10 text-success','bg-success'],warning:['border-warning/30 bg-warning/10 text-warning','bg-warning'],danger:['border-danger/30 bg-danger/10 text-danger','bg-danger'],neutral:['text-muted-foreground','bg-muted-foreground/60']};
export function State({state}:{state:string}){const [badge,dot]=tones[tone(state)]!;return <Badge variant="outline" className={badge}><span className={`mr-1.5 size-1.5 rounded-full ${dot}`}/>{stateNames()[state]??state}</Badge>}
