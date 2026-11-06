import subprocess,sys,json,os
sys.stdout.reconfigure(encoding='utf-8')
D=os.path.dirname(os.path.abspath(__file__))
for k in sys.argv[1:]:
    s=open(os.path.join(D,'find_tpl.cs'),encoding='utf-8').read().replace('__KEY__',k)
    p=os.path.join(D,'_f.cs'); open(p,'w',encoding='utf-8').write(s)
    r=subprocess.run([sys.executable,'-I',os.path.join(D,'umcp.py'),'code',p,'4000'],capture_output=True,text=True,encoding='utf-8').stdout
    try: print('['+k+'] '+json.loads(r[r.find('{'):])['data']['result'])
    except Exception: print(r)
