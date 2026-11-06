"""python dd.py <路径> <深度> [过滤词…]：打印节点层级，可只保留含过滤词的行"""
import subprocess,sys,json,os
sys.stdout.reconfigure(encoding='utf-8')
D=os.path.dirname(os.path.abspath(__file__))
s=open(os.path.join(D,'dump.cs'),encoding='utf-8').read().replace('__PATH__',sys.argv[1]).replace('__DEPTH__',sys.argv[2])
p=os.path.join(D,'_dd.cs'); open(p,'w',encoding='utf-8').write(s)
r=subprocess.run([sys.executable,'-I',os.path.join(D,'umcp.py'),'code',p,'30000'],capture_output=True,text=True,encoding='utf-8').stdout
t=json.loads(r[r.find('{'):])['data']['result']
ks=sys.argv[3:]
print('\n'.join(l for l in t.splitlines() if not ks or any(k in l for k in ks)))
