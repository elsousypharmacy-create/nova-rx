import os, pathlib, subprocess, tempfile
script = pathlib.Path('.github/scripts/kimi-save-checkpoint.sh').resolve()
def run(*args, cwd):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT).decode()
with tempfile.TemporaryDirectory() as temp:
    root=pathlib.Path(temp)
    run('git','init','-q',cwd=root)
    run('git','config','user.email','fixture@example.invalid',cwd=root)
    run('git','config','user.name','fixture',cwd=root)
    (root/'tracked.txt').write_text('original\n')
    run('git','add','.',cwd=root);run('git','commit','-qm','base',cwd=root)
    base=run('git','rev-parse','HEAD',cwd=root).strip()
    (root/'tracked.txt').write_text('partial change\n')
    (root/'docs/erp').mkdir(parents=True)
    (root/'docs/erp/partial.md').write_text('new unfinished draft\n')
    (root/'.env').write_text('EXCLUDED_FIXTURE=1\n')
    (root/'.github/workflows').mkdir(parents=True)
    (root/'.github/workflows/excluded.yml').write_text('excluded\n')
    env=dict(os.environ,KIMI_CHECKPOINT_BASE_SHA=base,ISSUE_NUMBER='103')
    subprocess.run(['bash',str(script)],cwd=root,env=env,check=True,capture_output=True)
    patch=(root/'kimi-recovery.patch').read_text()
    assert 'partial change' in patch and 'new unfinished draft' in patch
    assert 'EXCLUDED_FIXTURE' not in patch and 'excluded.yml' not in patch
    assert 'Issue: 103' in (root/'kimi-resume-note.md').read_text()
    run('git','checkout','--','tracked.txt',cwd=root)
    (root/'docs/erp/partial.md').unlink()
    run('git','reset','-q',cwd=root)
    run('git','apply','--check','kimi-recovery.patch',cwd=root)
    # A published recovery patch must survive a later clean-branch/push failure.
    (root/'tracked.txt').write_text('later unrelated change\n')
    subprocess.run(['bash',str(script)],cwd=root,env=env,check=True,capture_output=True)
    assert (root/'kimi-recovery.patch').read_text()==patch
print('PASS Kimi checkpoint: tracked/new drafts captured, secret/workflow paths excluded, patch applies, earlier patch preserved, no model calls')
