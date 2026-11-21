use anyhow::{Context as _, Result};
use rquickjs::{Context, Function, Module, Runtime};
use std::time::Instant;

pub(crate) struct EmbeddedPolicy {
    context: Context,
}

impl EmbeddedPolicy {
    pub(crate) fn open(name: &str, source: &str, endpoints: &[&str]) -> Result<Self> {
        Self::open_inner(name, source, endpoints, None)
    }

    pub(crate) fn open_with_deadline(
        name: &str,
        source: &str,
        endpoints: &[&str],
        deadline: Instant,
    ) -> Result<Self> {
        Self::open_inner(name, source, endpoints, Some(deadline))
    }

    fn open_inner(
        name: &str,
        source: &str,
        endpoints: &[&str],
        deadline: Option<Instant>,
    ) -> Result<Self> {
        let runtime = Runtime::new()?;
        runtime.set_memory_limit(8 * 1024 * 1024);
        if let Some(deadline) = deadline {
            runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
        }
        let context = Context::full(&runtime)?;
        context.with(|ctx| -> rquickjs::Result<()> {
            let (module, ready) = Module::declare(ctx.clone(), name, source)?.eval()?;
            ready.finish::<()>()?;
            for name in endpoints {
                let function: Function = module.get(*name)?;
                ctx.globals().set(*name, function)?;
            }
            Ok(())
        }).context("Load embedded policy")?;
        Ok(Self { context })
    }

    pub(crate) fn call<A: for<'js> rquickjs::function::IntoArgs<'js>>(&self, name: &str, args: A) -> Result<String> {
        self.context.with(|ctx| -> rquickjs::Result<String> {
            let function: Function = ctx.globals().get(name)?;
            function.call(args)
        }).context("Evaluate embedded policy")
    }
}
